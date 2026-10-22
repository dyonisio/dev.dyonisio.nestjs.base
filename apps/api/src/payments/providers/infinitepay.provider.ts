import { BadRequestException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { i18nKey } from '../../i18n/translations';
import type { Payment } from '../entities/payment.entity';
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentEvent,
  PaymentProvider,
  WebhookRequest,
} from './payment-provider';

const API = 'https://api.checkout.infinitepay.io';

export interface InfinitePayConfig {
  /** A InfiniteTag da conta, sem o "$". */
  handle: string;
  /** Código de cada compra na URL do webhook (o aviso da InfinitePay não vem assinado). */
  tokenFor: (paymentId: string) => string;
  fetch?: typeof fetch;
}

/**
 * Checkout Integrado da InfinitePay (Pix ou cartão em até 12x). Só pagamento único: a API pública
 * não tem assinatura recorrente. Também não tem ambiente de testes: teste com valores pequenos.
 *
 * Confiança: o webhook NÃO é assinado. A URL dele leva um código da compra (só a API sabe
 * gerar), e o pagamento só vale depois de confirmado em /payment_check.
 */
export class InfinitePayProvider implements PaymentProvider {
  readonly id = 'infinitepay' as const;
  readonly supports = { one_time: true, subscription: false };
  readonly methods = ['pix', 'card'] as const;
  /** Sem assinatura. */
  readonly cancelModes = [] as const;

  constructor(private readonly config: InfinitePayConfig) {}

  async createCheckout({
    payment,
    plan,
    customer,
    successUrl,
    webhookUrl,
    title,
  }: CheckoutInput): Promise<CheckoutResult> {
    const data = await this.post<Record<string, unknown>>('/links', {
      handle: this.config.handle,
      items: [{ quantity: 1, price: plan.amount, description: title }],
      order_nsu: payment.id,
      redirect_url: successUrl,
      webhook_url: `${webhookUrl}?token=${encodeURIComponent(this.config.tokenFor(payment.id))}`,
      customer: { name: customer.name, email: customer.email },
    });
    const url = [data.url, data.link, data.checkout_url, data.payment_url].find(
      (v): v is string => typeof v === 'string' && v.startsWith('https://'),
    );
    if (!url) throw new BadRequestException(i18nKey('payments.providerFailed'));
    const slug = typeof data.slug === 'string' ? data.slug : null;
    return { url, providerRef: slug ?? payment.id };
  }

  async handleWebhook({ rawBody, query }: WebhookRequest): Promise<PaymentEvent[]> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException(i18nKey('payments.invalidWebhook'));
    }
    const paymentId = typeof body.order_nsu === 'string' ? body.order_nsu : '';
    if (!paymentId || !this.validToken(paymentId, query.token)) {
      throw new BadRequestException(i18nKey('payments.invalidWebhook'));
    }
    const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
    return this.check(paymentId, {
      transaction_nsu: text(body.transaction_nsu),
      slug: text(body.invoice_slug ?? body.slug),
    });
  }

  /** Na volta, a InfinitePay põe transaction_nsu e slug na URL: com eles, a consulta confirma. */
  confirm(payment: Payment, params: Record<string, string>): Promise<PaymentEvent[]> {
    if (!params.transaction_nsu || !params.slug) return Promise.resolve([]);
    return this.check(payment.id, { transaction_nsu: params.transaction_nsu, slug: params.slug });
  }

  private async check(
    paymentId: string,
    refs: { transaction_nsu: string; slug: string },
  ): Promise<PaymentEvent[]> {
    const result = await this.post<{ paid?: boolean; paid_amount?: number; amount?: number }>(
      '/payment_check',
      { handle: this.config.handle, order_nsu: paymentId, ...refs },
    );
    if (!result.paid) return [];
    return [
      {
        type: 'payment.paid',
        paymentId,
        amount: result.paid_amount ?? result.amount,
        providerRef: refs.slug || undefined,
      },
    ];
  }

  private validToken(paymentId: string, token: unknown): boolean {
    if (typeof token !== 'string') return false;
    const expected = Buffer.from(this.config.tokenFor(paymentId));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await (this.config.fetch ?? fetch)(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new BadRequestException(i18nKey('payments.providerFailed'));
    return (await response.json()) as T;
  }
}
