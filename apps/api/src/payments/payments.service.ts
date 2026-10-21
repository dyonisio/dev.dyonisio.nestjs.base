import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/request-context/request-context';
import { i18nKey } from '../i18n/translations';
import { UsersService } from '../users/users.service';
import {
  BillingDto,
  CheckoutResponseDto,
  PaymentDto,
  PlansResponseDto,
  SubscriptionDto,
} from './dto/payments.dto';
import { Payment } from './entities/payment.entity';
import { Subscription } from './entities/subscription.entity';
import { PaymentProviders } from './payment-providers';
import { findPlan, PLANS, type Plan } from './plans';
import type { PaymentEvent, PaymentProvider, WebhookRequest } from './providers/payment-provider';

/**
 * Pagamentos com qualquer plataforma ligada (Stripe, InfinitePay, AbacatePay), pela mesma
 * interface (providers/payment-provider.ts).
 *
 * Regra de ouro: nada vira "pago" pela palavra do navegador. Só pelo que a plataforma confirma
 * (webhook verificado ou consulta à API dela) — e com o valor conferido.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    private readonly providers: PaymentProviders,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** O catálogo, cada plano com as plataformas ligadas que conseguem cobrá-lo. */
  plans(): PlansResponseDto {
    const lang = RequestContext.get()?.requestedLang === 'pt-BR' ? 'pt-BR' : 'en';
    return {
      plans: PLANS.map((plan) => ({
        id: plan.id,
        kind: plan.kind,
        interval: plan.interval,
        amount: plan.amount,
        currency: plan.currency,
        name: plan.name[lang],
        description: plan.description[lang],
        providers: this.providersFor(plan).map((p) => p.id),
      })),
      providers: this.providers.all().map((p) => ({ id: p.id, methods: [...p.methods] })),
    };
  }

  async checkout(
    userId: string,
    planId: string,
    providerId?: string,
  ): Promise<CheckoutResponseDto> {
    const plan = findPlan(planId);
    if (!plan) throw new NotFoundException(i18nKey('payments.planNotFound'));
    const provider = this.pickProvider(plan, providerId);
    await this.ensureNotOwned(userId, plan);

    const user = await this.users.getById(userId);
    const payment = await this.payments.save(
      this.payments.create({
        userId,
        planId: plan.id,
        kind: plan.kind,
        provider: provider.id,
        status: 'pending',
        amount: plan.amount,
        currency: plan.currency,
      }),
    );

    const front = this.config.get<string>('app.frontendUrl', '').replace(/\/$/, '');
    const api = this.config.get<string>('payments.publicApiUrl', '').replace(/\/$/, '');
    const lang = RequestContext.get()?.requestedLang === 'pt-BR' ? 'pt-BR' : 'en';
    const { url, providerRef } = await provider.createCheckout({
      payment,
      plan,
      title: plan.name[lang],
      customer: { name: user.name, email: user.email },
      successUrl: `${front}/billing/return?payment=${payment.id}`,
      cancelUrl: `${front}/billing?canceled=1`,
      webhookUrl: api ? `${api}/api/v1/payments/webhooks/${provider.id}` : '',
    });
    payment.providerRef = providerRef;
    await this.payments.save(payment);
    return { url, paymentId: payment.id };
  }

  /** Na volta do checkout: pergunta à plataforma (o webhook pode chegar depois). */
  async confirm(userId: string, paymentId: string, params: Record<string, string> = {}) {
    const payment = await this.payments.findOne({ where: { id: paymentId, userId } });
    if (!payment) throw new NotFoundException(i18nKey('payments.notFound'));
    if (payment.status === 'pending') {
      const provider = this.providers.get(payment.provider);
      if (provider) await this.apply(provider, await provider.confirm(payment, params));
    }
    const fresh = await this.payments.findOneByOrFail({ id: paymentId });
    return PaymentDto.from(fresh);
  }

  async billing(userId: string): Promise<BillingDto> {
    const [payments, subscriptions] = await Promise.all([
      this.payments.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 }),
      this.subscriptions.find({ where: { userId }, order: { createdAt: 'DESC' } }),
    ]);
    const current = subscriptions.find((s) => s.status !== 'canceled') ?? subscriptions[0] ?? null;
    const lifetime = payments.some(
      (p) => p.status === 'paid' && p.kind === 'one_time' && p.planId === 'pro-lifetime',
    );
    return {
      plan: lifetime || subscriptions.some((s) => s.status !== 'canceled') ? 'pro' : 'free',
      subscription: current ? SubscriptionDto.from(current) : null,
      payments: payments
        .filter((p) => p.status !== 'pending' || Date.now() - p.createdAt.getTime() < 86_400_000)
        .map((p) => PaymentDto.from(p)),
    };
  }

  async cancelSubscription(userId: string, subscriptionId: string): Promise<SubscriptionDto> {
    const sub = await this.subscriptions.findOne({ where: { id: subscriptionId, userId } });
    if (!sub) throw new NotFoundException(i18nKey('payments.subscriptionNotFound'));
    if (sub.status === 'canceled' || sub.cancelAtPeriodEnd) return SubscriptionDto.from(sub);
    const provider = this.providers.get(sub.provider);
    if (!provider?.cancelSubscription) {
      throw new BadRequestException(i18nKey('payments.providerUnavailable'));
    }
    await this.apply(provider, await provider.cancelSubscription(sub));
    return SubscriptionDto.from(await this.subscriptions.findOneByOrFail({ id: sub.id }));
  }

  /** Aviso da plataforma: ela confere (assinatura/segredo/consulta) e aqui só se aplica. */
  async webhook(providerId: string, request: WebhookRequest): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new NotFoundException(i18nKey('payments.providerUnavailable'));
    await this.apply(provider, await provider.handleWebhook(request));
  }

  // ---------------------------------------------------------------- internos

  private providersFor(plan: Plan): PaymentProvider[] {
    return this.providers
      .all()
      .filter((p) => p.supports[plan.kind] && (p.supportsPlan?.(plan) ?? true));
  }

  private pickProvider(plan: Plan, providerId?: string): PaymentProvider {
    const candidates = this.providersFor(plan);
    if (!candidates.length) throw new BadRequestException(i18nKey('payments.unavailable'));
    if (providerId) {
      const chosen = candidates.find((p) => p.id === providerId);
      if (!chosen) throw new BadRequestException(i18nKey('payments.providerUnavailable'));
      return chosen;
    }
    if (candidates.length > 1) throw new BadRequestException(i18nKey('payments.chooseProvider'));
    return candidates[0];
  }

  private async ensureNotOwned(userId: string, plan: Plan): Promise<void> {
    if (plan.kind === 'subscription') {
      const active = await this.subscriptions.exists({
        where: { userId, planId: plan.id, status: In(['active', 'past_due']) },
      });
      if (active) throw new BadRequestException(i18nKey('payments.alreadySubscribed'));
    } else {
      const paid = await this.payments.exists({
        where: { userId, planId: plan.id, status: 'paid' },
      });
      if (paid) throw new BadRequestException(i18nKey('payments.alreadyPurchased'));
    }
  }

  /** Aplica o que a plataforma confirmou. Repetir o mesmo aviso não muda nada (idempotente). */
  private async apply(provider: PaymentProvider, events: PaymentEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type === 'payment.paid') await this.markPaid(provider, event);
      else if (event.type === 'payment.refunded')
        await this.markRefunded(provider, event.paymentId);
      else await this.syncSubscription(provider, event);
    }
  }

  private async markPaid(
    provider: PaymentProvider,
    event: Extract<PaymentEvent, { type: 'payment.paid' }>,
  ): Promise<void> {
    const payment = await this.payments.findOne({
      where: { id: event.paymentId, provider: provider.id },
    });
    if (!payment || payment.status === 'paid' || payment.status === 'refunded') return;
    // Pagou menos do que o plano custa (produto errado na plataforma, valor adulterado): não libera
    if (event.amount !== undefined && event.amount < payment.amount) {
      this.logger.warn(
        `${provider.id}: compra ${payment.id} paga com ${event.amount}, esperado ${payment.amount}`,
      );
      return;
    }
    payment.status = 'paid';
    payment.paidAt = new Date();
    if (event.providerRef) payment.providerRef = event.providerRef;
    await this.payments.save(payment);
    await this.audit.record(AuditAction.PAYMENT_PAID, {
      actorId: payment.userId,
      target: { type: 'user', id: payment.userId },
      metadata: {
        payment: payment.id,
        plan: payment.planId,
        provider: provider.id,
        amount: payment.amount,
      },
    });
  }

  private async markRefunded(provider: PaymentProvider, paymentId: string): Promise<void> {
    const payment = await this.payments.findOne({
      where: { id: paymentId, provider: provider.id },
    });
    if (!payment || payment.status === 'refunded') return;
    payment.status = 'refunded';
    await this.payments.save(payment);
    await this.audit.record(AuditAction.PAYMENT_REFUNDED, {
      actorId: payment.userId,
      target: { type: 'user', id: payment.userId },
      metadata: { payment: payment.id, provider: provider.id },
    });
  }

  private async syncSubscription(
    provider: PaymentProvider,
    event: Extract<PaymentEvent, { type: 'subscription.updated' }>,
  ): Promise<void> {
    let sub = await this.subscriptions.findOne({
      where: { provider: provider.id, providerSubscriptionId: event.providerSubscriptionId },
    });
    const started = !sub;
    if (!sub) {
      // primeira notícia da assinatura: a compra que a iniciou diz de quem é e qual plano
      const payment = event.paymentId
        ? await this.payments.findOne({ where: { id: event.paymentId, provider: provider.id } })
        : null;
      if (!payment) {
        this.logger.warn(
          `${provider.id}: assinatura ${event.providerSubscriptionId} sem compra conhecida`,
        );
        return;
      }
      sub = this.subscriptions.create({
        userId: payment.userId,
        planId: payment.planId,
        provider: provider.id,
        providerSubscriptionId: event.providerSubscriptionId,
        status: event.status,
        cancelAtPeriodEnd: false,
      });
    }
    const wasCanceled = !started && sub.status === 'canceled';
    sub.status = event.status;
    if (event.cancelAtPeriodEnd !== undefined) sub.cancelAtPeriodEnd = event.cancelAtPeriodEnd;
    if (event.currentPeriodEnd !== undefined) sub.currentPeriodEnd = event.currentPeriodEnd;
    if (event.status === 'canceled' && !sub.canceledAt) sub.canceledAt = new Date();
    await this.subscriptions.save(sub);

    const target = { type: 'user' as const, id: sub.userId };
    const metadata = { subscription: sub.id, plan: sub.planId, provider: provider.id };
    if (started) {
      await this.audit.record(AuditAction.SUBSCRIPTION_STARTED, {
        actorId: sub.userId,
        target,
        metadata,
      });
    } else if (event.status === 'canceled' && !wasCanceled) {
      await this.audit.record(AuditAction.SUBSCRIPTION_CANCELED, {
        actorId: sub.userId,
        target,
        metadata,
      });
    }
  }
}
