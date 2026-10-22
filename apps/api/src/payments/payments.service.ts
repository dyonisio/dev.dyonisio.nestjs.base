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
  type AdminBillingDto,
  type AdminCancelMode,
  AdminGrantDto,
  type GiveGrantDto,
} from './dto/admin-billing.dto';
import {
  BillingDto,
  GrantDto,
  CheckoutResponseDto,
  PaymentDto,
  PlansResponseDto,
  SubscriptionDto,
} from './dto/payments.dto';
import { Payment } from './entities/payment.entity';
import { Subscription } from './entities/subscription.entity';
import { GrantsService } from './grants.service';
import { PaymentProviders } from './payment-providers';
import { planText, type Plan } from './plans';
import { PlansService } from './plans.service';
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
    private readonly plansService: PlansService,
    private readonly grants: GrantsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** O que está à venda, cada plano com as plataformas ligadas que conseguem cobrá-lo. */
  async plans(): Promise<PlansResponseDto> {
    const lang = RequestContext.get()?.requestedLang ?? 'en';
    return {
      plans: (await this.plansService.listActive()).map((plan) => ({
        id: plan.id,
        kind: plan.kind,
        interval: plan.interval ?? undefined,
        amount: plan.amount,
        currency: plan.currency,
        ...planText(plan, lang),
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
    const plan = await this.plansService.findActive(planId);
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
    const { url, providerRef } = await provider.createCheckout({
      payment,
      plan,
      title: planText(plan, RequestContext.get()?.requestedLang ?? 'en').name,
      customer: { name: user.name, email: user.email },
      successUrl: `${front}/billing/return?payment=${payment.id}`,
      cancelUrl: `${front}/billing?canceled=1`,
      webhookUrl: api ? `${api}/api/v1/payments/webhooks/${provider.id}` : '',
      products: {
        get: (key) => plan.providerProducts?.[provider.id]?.[key],
        save: (key, productId) =>
          this.plansService.rememberProduct(plan.id, provider.id, key, productId),
      },
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
    const state = await this.state(userId);
    return {
      plan: state.plan,
      lifetime: state.lifetime,
      grant: state.grant ? GrantDto.from(state.grant) : null,
      subscription: state.current ? SubscriptionDto.from(state.current) : null,
      payments: state.payments
        .filter((p) => p.status !== 'pending' || Date.now() - p.createdAt.getTime() < 86_400_000)
        .map((p) => PaymentDto.from(p)),
    };
  }

  // ---------------------------------------------------------------- admin

  /** O plano de um usuário, com o que o admin pode fazer em cada item. */
  async adminBilling(userId: string): Promise<AdminBillingDto> {
    await this.users.getById(userId);
    const state = await this.state(userId);
    return {
      plan: state.plan,
      lifetime: state.lifetime,
      grant: state.grant ? AdminGrantDto.fromGrant(state.grant) : null,
      subscription: state.current
        ? {
            ...SubscriptionDto.from(state.current),
            cancelOptions: this.cancelOptions(state.current),
          }
        : null,
      payments: state.payments.map((p) => ({ ...PaymentDto.from(p), refund: this.refundKind(p) })),
    };
  }

  /** Cancela pelo admin: só cancelar (no fim do período ou agora) ou cancelar devolvendo a última cobrança. */
  async adminCancel(
    userId: string,
    subscriptionId: string,
    mode: AdminCancelMode,
    actorId: string,
  ): Promise<AdminBillingDto> {
    const sub = await this.subscriptions.findOne({ where: { id: subscriptionId, userId } });
    if (!sub) throw new NotFoundException(i18nKey('payments.subscriptionNotFound'));
    if (!this.cancelOptions(sub).includes(mode)) {
      throw new BadRequestException(i18nKey('payments.cancelModeUnavailable'));
    }
    // cancelOptions só oferece o que a plataforma ligada sabe fazer
    const provider = this.providers.get(sub.provider)!;
    const events =
      mode === 'now_refund'
        ? await provider.cancelAndRefund!(sub)
        : await provider.cancelSubscription!(sub, mode);
    await this.apply(provider, events);
    await this.audit.record(AuditAction.ADMIN_SUBSCRIPTION_CANCELED, {
      actorId,
      target: { type: 'user', id: userId },
      metadata: { subscription: sub.id, provider: provider.id, mode },
    });
    return this.adminBilling(userId);
  }

  /**
   * Reembolso de uma compra única paga. Onde a plataforma tem API, devolve por lá; onde não tem
   * (InfinitePay), o admin devolve no app dela e aqui só registra.
   */
  async adminRefund(
    userId: string,
    paymentId: string,
    reason: string | undefined,
    actorId: string,
  ): Promise<AdminBillingDto> {
    const payment = await this.payments.findOne({ where: { id: paymentId, userId } });
    if (!payment) throw new NotFoundException(i18nKey('payments.notFound'));
    const kind = this.refundKind(payment);
    if (!kind) throw new BadRequestException(i18nKey('payments.notRefundable'));
    if (kind === 'api') {
      const provider = this.providers.get(payment.provider)!;
      await this.apply(provider, await provider.refund!(payment, reason));
    } else {
      await this.markRefunded(payment.provider, payment.id);
    }
    await this.audit.record(AuditAction.ADMIN_PAYMENT_REFUNDED, {
      actorId,
      target: { type: 'user', id: userId },
      metadata: {
        payment: payment.id,
        provider: payment.provider,
        amount: payment.amount,
        manual: kind === 'manual',
        ...(reason ? { reason } : {}),
      },
    });
    return this.adminBilling(userId);
  }

  /** Pro de cortesia. Quem já tem o vitalício ou paga assinatura não precisa (por ora). */
  async adminGrant(userId: string, dto: GiveGrantDto, actorId: string): Promise<AdminBillingDto> {
    await this.users.getById(userId);
    const state = await this.state(userId);
    if (state.lifetime) throw new BadRequestException(i18nKey('payments.alreadyLifetime'));
    if (state.current && state.current.status !== 'canceled') {
      throw new BadRequestException(i18nKey('payments.grantHasSubscription'));
    }
    await this.grants.give(userId, dto, actorId);
    return this.adminBilling(userId);
  }

  async adminRevokeGrant(userId: string, actorId: string): Promise<AdminBillingDto> {
    await this.users.getById(userId);
    await this.grants.revoke(userId, actorId);
    return this.adminBilling(userId);
  }

  async cancelSubscription(userId: string, subscriptionId: string): Promise<SubscriptionDto> {
    const sub = await this.subscriptions.findOne({ where: { id: subscriptionId, userId } });
    if (!sub) throw new NotFoundException(i18nKey('payments.subscriptionNotFound'));
    if (sub.status === 'canceled' || sub.cancelAtPeriodEnd) return SubscriptionDto.from(sub);
    const provider = this.providers.get(sub.provider);
    const [mode] = provider?.cancelModes ?? [];
    if (!provider?.cancelSubscription || !mode) {
      throw new BadRequestException(i18nKey('payments.providerUnavailable'));
    }
    // a própria pessoa: o jeito mais gentil que a plataforma tiver (no fim do período, se houver)
    await this.apply(provider, await provider.cancelSubscription(sub, mode));
    return SubscriptionDto.from(await this.subscriptions.findOneByOrFail({ id: sub.id }));
  }

  /** Aviso da plataforma: ela confere (assinatura/segredo/consulta) e aqui só se aplica. */
  async webhook(providerId: string, request: WebhookRequest): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new NotFoundException(i18nKey('payments.providerUnavailable'));
    await this.apply(provider, await provider.handleWebhook(request));
  }

  // ---------------------------------------------------------------- internos

  /** Tudo o que decide o plano de alguém. */
  private async state(userId: string) {
    const [payments, subscriptions, grant] = await Promise.all([
      this.payments.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 }),
      this.subscriptions.find({ where: { userId }, order: { createdAt: 'DESC' } }),
      this.grants.active(userId),
    ]);
    const current = subscriptions.find((s) => s.status !== 'canceled') ?? subscriptions[0] ?? null;
    // Exemplo: qualquer plano pago de uma vez (e não reembolsado) dá o Pro para sempre
    const lifetime = payments.some((p) => p.status === 'paid' && p.kind === 'one_time');
    const subscribed = subscriptions.some((s) => s.status !== 'canceled');
    const plan: 'free' | 'pro' = lifetime || subscribed || grant ? 'pro' : 'free';
    return { plan, lifetime, grant, current, payments };
  }

  /** Como o admin pode cancelar esta assinatura, pelo que a plataforma dela sabe fazer. */
  private cancelOptions(sub: Subscription): AdminCancelMode[] {
    const provider = this.providers.get(sub.provider);
    if (sub.status === 'canceled' || !provider?.cancelSubscription) return [];
    const modes: AdminCancelMode[] = provider.cancelModes.filter(
      (m) => m !== 'period_end' || !sub.cancelAtPeriodEnd,
    );
    return provider.cancelAndRefund ? [...modes, 'now_refund'] : modes;
  }

  /** Compra única paga: por API, se a plataforma tem; senão, o admin registra o que fez lá. */
  private refundKind(payment: Payment): 'api' | 'manual' | null {
    if (payment.status !== 'paid' || payment.kind !== 'one_time') return null;
    return this.providers.get(payment.provider)?.refund ? 'api' : 'manual';
  }

  private providersFor(plan: Plan): PaymentProvider[] {
    return this.providers.all().filter((p) => p.supports[plan.kind]);
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
    // Já tem o vitalício (exemplo: qualquer plano único pago): o Pro é dele para sempre, e
    // assinar ou comprar outro plano só o faria pagar à toa
    const lifetime = await this.payments.exists({
      where: { userId, kind: 'one_time', status: 'paid' },
    });
    if (lifetime) throw new BadRequestException(i18nKey('payments.alreadyLifetime'));
  }

  /** Aplica o que a plataforma confirmou. Repetir o mesmo aviso não muda nada (idempotente). */
  private async apply(provider: PaymentProvider, events: PaymentEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type === 'payment.paid') await this.markPaid(provider, event);
      else if (event.type === 'payment.refunded')
        await this.markRefunded(provider.id, event.paymentId);
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

  private async markRefunded(providerId: string, paymentId: string): Promise<void> {
    const payment = await this.payments.findOne({
      where: { id: paymentId, provider: providerId },
    });
    if (!payment || payment.status === 'refunded') return;
    payment.status = 'refunded';
    await this.payments.save(payment);
    await this.audit.record(AuditAction.PAYMENT_REFUNDED, {
      actorId: payment.userId,
      target: { type: 'user', id: payment.userId },
      metadata: { payment: payment.id, provider: providerId },
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
