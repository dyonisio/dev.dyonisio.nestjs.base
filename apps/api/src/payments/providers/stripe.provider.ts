import { BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { i18nKey } from '../../i18n/translations';
import type { Payment } from '../entities/payment.entity';
import type { Subscription } from '../entities/subscription.entity';
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentEvent,
  PaymentProvider,
  WebhookRequest,
} from './payment-provider';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
}

/**
 * Stripe Checkout (página hospedada pela Stripe). O plano vai na hora (price_data): não precisa
 * cadastrar produto no painel. Teste com as chaves sk_test_ e os cartões de teste da Stripe.
 *
 * Confiança: o webhook vem assinado (Stripe-Signature, conferido com STRIPE_WEBHOOK_SECRET) e o
 * estado da assinatura é sempre lido de novo da Stripe — o corpo do evento não é a fonte.
 */
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  readonly supports = { one_time: true, subscription: true };
  readonly methods = ['card'] as const;
  /** Público para os testes trocarem as chamadas à Stripe por respostas de mentira. */
  readonly client: Stripe;

  constructor(private readonly config: StripeConfig) {
    this.client = new Stripe(config.secretKey);
  }

  async createCheckout({
    payment,
    plan,
    customer,
    successUrl,
    cancelUrl,
    title,
  }: CheckoutInput): Promise<CheckoutResult> {
    const recurring = plan.kind === 'subscription';
    const metadata = { paymentId: payment.id };
    const session = await this.client.checkout.sessions.create({
      mode: recurring ? 'subscription' : 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: plan.currency.toLowerCase(),
            unit_amount: plan.amount,
            product_data: { name: title },
            ...(recurring ? { recurring: { interval: plan.interval ?? 'month' } } : {}),
          },
        },
      ],
      customer_email: customer.email,
      client_reference_id: payment.id,
      metadata,
      // o id da compra vai junto em tudo o que a Stripe cria (reembolso, renovação...)
      ...(recurring ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!session.url) throw new BadRequestException(i18nKey('payments.providerFailed'));
    return { url: session.url, providerRef: session.id };
  }

  async handleWebhook({ rawBody, headers }: WebhookRequest): Promise<PaymentEvent[]> {
    const signature = headers['stripe-signature'];
    let event: Stripe.Event;
    try {
      event = this.client.webhooks.constructEvent(
        rawBody,
        typeof signature === 'string' ? signature : '',
        this.config.webhookSecret,
      );
    } catch {
      throw new BadRequestException(i18nKey('payments.invalidWebhook'));
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return this.fromSession(event.data.object);
      case 'invoice.paid': {
        // renovação: o período avança
        const id = subscriptionIdOf(event.data.object);
        return id ? [await this.syncSubscription(id)] : [];
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return [this.fromSubscription(event.data.object)];
      case 'charge.refunded': {
        const charge = event.data.object;
        if (!charge.refunded || typeof charge.payment_intent !== 'string') return [];
        const intent = await this.client.paymentIntents.retrieve(charge.payment_intent);
        const paymentId = intent.metadata?.paymentId;
        return paymentId ? [{ type: 'payment.refunded', paymentId }] : [];
      }
      default:
        return [];
    }
  }

  async confirm(payment: Payment): Promise<PaymentEvent[]> {
    if (!payment.providerRef) return [];
    return this.fromSession(await this.client.checkout.sessions.retrieve(payment.providerRef));
  }

  /** Cancela no fim do período já pago (a Stripe avisa quando terminar). */
  async cancelSubscription(subscription: Subscription): Promise<PaymentEvent[]> {
    const updated = await this.client.subscriptions.update(subscription.providerSubscriptionId, {
      cancel_at_period_end: true,
    });
    return [this.fromSubscription(updated)];
  }

  private async fromSession(session: Stripe.Checkout.Session): Promise<PaymentEvent[]> {
    const paymentId = session.metadata?.paymentId ?? session.client_reference_id ?? undefined;
    if (!paymentId) return [];
    // Pix/boleto chegam "completed" ainda sem pagamento: espera o async_payment_succeeded
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return [];
    }
    const events: PaymentEvent[] = [
      {
        type: 'payment.paid',
        paymentId,
        amount: session.amount_total ?? undefined,
        providerRef: session.id,
      },
    ];
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (subscriptionId) events.push(await this.syncSubscription(subscriptionId, paymentId));
    return events;
  }

  private async syncSubscription(id: string, paymentId?: string): Promise<PaymentEvent> {
    const event = this.fromSubscription(await this.client.subscriptions.retrieve(id));
    return paymentId && event.type === 'subscription.updated' ? { ...event, paymentId } : event;
  }

  private fromSubscription(sub: Stripe.Subscription): PaymentEvent {
    // Nas versões recentes da API, o período fica em cada item da assinatura
    const ends = sub.items?.data.map((item) => item.current_period_end).filter(Boolean) ?? [];
    return {
      type: 'subscription.updated',
      paymentId: sub.metadata?.paymentId,
      providerSubscriptionId: sub.id,
      status: statusOf(sub.status),
      cancelAtPeriodEnd: sub.cancel_at_period_end || !!sub.cancel_at,
      currentPeriodEnd: ends.length ? new Date(Math.max(...ends) * 1000) : null,
    };
  }
}

function statusOf(status: Stripe.Subscription.Status): Subscription['status'] {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled';
  return 'past_due';
}

/** A fatura aponta para a assinatura em parent.subscription_details (API nova). */
function subscriptionIdOf(invoice: Stripe.Invoice): string | undefined {
  const ref = invoice.parent?.subscription_details?.subscription;
  return typeof ref === 'string' ? ref : ref?.id;
}
