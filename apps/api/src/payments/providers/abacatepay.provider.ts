import { BadRequestException, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { i18nKey } from '../../i18n/translations';
import type { Payment } from '../entities/payment.entity';
import type { Subscription } from '../entities/subscription.entity';
import type { Plan } from '../plans';
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentEvent,
  PaymentProvider,
  WebhookRequest,
} from './payment-provider';

const API = 'https://api.abacatepay.com/v2';

/**
 * Chave PÚBLICA que a AbacatePay usa para assinar os webhooks (X-Webhook-Signature).
 * Não é segredo: está na documentação dela (docs.abacatepay.com → Webhooks → Segurança).
 */
export const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

export interface AbacatePayConfig {
  apiKey: string;
  /** O secret do webhook cadastrado na AbacatePay (vem em ?webhookSecret= na URL). */
  webhookSecret: string;
  /** plano do catálogo → id do produto na AbacatePay (ABACATEPAY_PRODUCTS). */
  products: Record<string, string>;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;

/**
 * AbacatePay (Pix e cartão), com pagamento único e assinatura. Cobra por PRODUTOS cadastrados
 * nela: cada plano do catálogo precisa de um produto lá (o de assinatura com ciclo), mapeado em
 * ABACATEPAY_PRODUCTS. Teste com a chave do Dev mode.
 *
 * Confiança: o webhook traz o secret na URL e a assinatura HMAC do corpo; os dois são conferidos.
 * Na volta do checkout, a cobrança é consultada na API dela.
 */
export class AbacatePayProvider implements PaymentProvider {
  readonly id = 'abacatepay' as const;
  readonly supports = { one_time: true, subscription: true };
  readonly methods = ['pix', 'card'] as const;
  private readonly logger = new Logger('AbacatePay');

  constructor(private readonly config: AbacatePayConfig) {}

  supportsPlan(plan: Plan): boolean {
    return !!this.config.products[plan.id];
  }

  async createCheckout({
    payment,
    plan,
    successUrl,
    cancelUrl,
  }: CheckoutInput): Promise<CheckoutResult> {
    const productId = this.config.products[plan.id];
    if (!productId) throw new BadRequestException(i18nKey('payments.providerUnavailable'));
    const recurring = plan.kind === 'subscription';
    const data = await this.request<Json>(
      'POST',
      recurring ? '/subscriptions/create' : '/checkouts/create',
      {
        items: [{ id: productId, quantity: 1 }],
        externalId: payment.id,
        completionUrl: successUrl,
        returnUrl: cancelUrl,
        metadata: { paymentId: payment.id },
        ...(recurring ? { methods: ['CARD'] } : {}),
      },
    );
    if (typeof data.url !== 'string' || typeof data.id !== 'string') {
      throw new BadRequestException(i18nKey('payments.providerFailed'));
    }
    return { url: data.url, providerRef: data.id };
  }

  handleWebhook(request: WebhookRequest): Promise<PaymentEvent[]> {
    // sempre uma promessa (rejeitada se o aviso for inválido), como nas outras plataformas
    try {
      return Promise.resolve(this.parseWebhook(request));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private parseWebhook({ rawBody, headers, query }: WebhookRequest): PaymentEvent[] {
    if (!this.validSecret(query.webhookSecret) || !this.validSignature(rawBody, headers)) {
      throw new BadRequestException(i18nKey('payments.invalidWebhook'));
    }
    let body: Json;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Json;
    } catch {
      throw new BadRequestException(i18nKey('payments.invalidWebhook'));
    }
    const event = typeof body.event === 'string' ? body.event : '';
    const data = (body.data ?? {}) as Json;
    const paymentId = paymentIdOf(data);
    const subscriptionId = subscriptionIdOf(data);

    switch (event) {
      case 'checkout.completed':
        return paymentId ? [{ type: 'payment.paid', paymentId, amount: amountOf(data) }] : [];
      case 'checkout.refunded':
        return paymentId ? [{ type: 'payment.refunded', paymentId }] : [];
      case 'subscription.completed':
      case 'subscription.renewed':
      case 'subscription.cancelled': {
        if (!subscriptionId) {
          this.logger.warn(
            `${event} sem id de assinatura reconhecível (campos: ${Object.keys(data).join(', ')})`,
          );
          return [];
        }
        const events: PaymentEvent[] = [];
        if (event === 'subscription.completed' && paymentId) {
          events.push({ type: 'payment.paid', paymentId, amount: amountOf(data) });
        }
        events.push({
          type: 'subscription.updated',
          paymentId,
          providerSubscriptionId: subscriptionId,
          status: event === 'subscription.cancelled' ? 'canceled' : 'active',
        });
        return events;
      }
      default:
        return [];
    }
  }

  async confirm(payment: Payment): Promise<PaymentEvent[]> {
    if (!payment.providerRef) return [];
    const path =
      payment.kind === 'subscription' ? '/subscriptions/checkouts/get' : '/checkouts/get';
    const data = await this.request<Json>(
      'GET',
      `${path}?id=${encodeURIComponent(payment.providerRef)}`,
    );
    if (data.status !== 'PAID') return [];
    return [{ type: 'payment.paid', paymentId: payment.id, amount: amountOf(data) }];
  }

  /** A AbacatePay cancela na hora (sem "até o fim do período"). */
  async cancelSubscription(subscription: Subscription): Promise<PaymentEvent[]> {
    await this.request('POST', '/subscriptions/cancel', {
      id: subscription.providerSubscriptionId,
    });
    return [
      {
        type: 'subscription.updated',
        providerSubscriptionId: subscription.providerSubscriptionId,
        status: 'canceled',
      },
    ];
  }

  private validSecret(given: unknown): boolean {
    if (typeof given !== 'string' || !this.config.webhookSecret) return false;
    return safeEqual(given, this.config.webhookSecret);
  }

  /** HMAC-SHA256 do corpo exato (cru), com a chave pública da AbacatePay, em base64. */
  private validSignature(rawBody: Buffer, headers: WebhookRequest['headers']): boolean {
    const header = headers['x-webhook-signature'];
    if (typeof header !== 'string') return false;
    const expected = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(rawBody).digest('base64');
    return safeEqual(header, expected);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await (this.config.fetch ?? fetch)(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json().catch(() => ({}))) as { data?: T; error?: unknown };
    if (!response.ok || json.error) {
      this.logger.warn(`${method} ${path} → ${response.status}: ${JSON.stringify(json.error)}`);
      throw new BadRequestException(i18nKey('payments.providerFailed'));
    }
    return (json.data ?? {}) as T;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * O formato exato de cada evento não está na documentação: os campos são procurados nos lugares
 * prováveis (o próprio objeto, ou aninhado em checkout/billing/subscription).
 */
function nested(data: Json): Json[] {
  return [data, data.checkout, data.billing, data.subscription].filter(
    (v): v is Json => !!v && typeof v === 'object',
  );
}

function paymentIdOf(data: Json): string | undefined {
  for (const obj of nested(data)) {
    if (typeof obj.externalId === 'string') return obj.externalId;
    const meta = obj.metadata as Json | undefined;
    if (meta && typeof meta.paymentId === 'string') return meta.paymentId;
  }
  return undefined;
}

function subscriptionIdOf(data: Json): string | undefined {
  const sub = data.subscription as Json | undefined;
  if (sub && typeof sub.id === 'string') return sub.id;
  if (typeof data.subscriptionId === 'string') return data.subscriptionId;
  if (typeof data.id === 'string' && data.id.startsWith('subs_')) return data.id;
  return undefined;
}

function amountOf(data: Json): number | undefined {
  for (const obj of nested(data)) {
    const value = obj.paidAmount ?? obj.amount;
    if (typeof value === 'number') return value;
  }
  return undefined;
}
