import { createHmac } from 'crypto';
import type { Payment } from '../entities/payment.entity';
import type { Subscription } from '../entities/subscription.entity';
import { findPlan } from '../plans';
import { ABACATEPAY_PUBLIC_KEY, AbacatePayProvider } from './abacatepay.provider';
import { InfinitePayProvider } from './infinitepay.provider';
import type { CheckoutInput, WebhookRequest } from './payment-provider';
import { StripeProvider } from './stripe.provider';

/** Os fluxos completos (HTTP + banco) estão em test/payments.e2e-spec.ts; aqui, os casos de borda. */
const life = findPlan('pro-lifetime')!;
const monthly = findPlan('pro-monthly')!;
const payment = (extra: Partial<Payment> = {}) =>
  ({ id: 'pay-1', kind: 'one_time', providerRef: 'ref-1', amount: 9900, ...extra }) as Payment;
const input = (plan = life): CheckoutInput => ({
  payment: payment(),
  plan,
  title: 'Pro',
  customer: { name: 'Ana', email: 'ana@x.com' },
  successUrl: 'https://front/ok',
  cancelUrl: 'https://front/no',
  webhookUrl: 'https://api/hook',
});
const webhook = (body: unknown, extra: Partial<WebhookRequest> = {}): WebhookRequest => ({
  rawBody: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  headers: {},
  query: {},
  ...extra,
});

/** Um fetch de mentira que responde `reply` e guarda as chamadas. */
function fakeFetch(reply: (url: string) => { status?: number; body: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = reply(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// ---------------------------------------------------------------- Stripe

describe('StripeProvider', () => {
  const provider = new StripeProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x' });
  const signed = (event: object) => {
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', ...event });
    return webhook(payload, {
      headers: {
        'stripe-signature': provider.client.webhooks.generateTestHeaderString({
          payload,
          secret: 'whsec_x',
        }),
      },
    });
  };
  const sub = (extra: object = {}) => ({
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: {},
    items: { data: [{ current_period_end: 1_800_000_000 }] },
    ...extra,
  });

  afterEach(() => jest.restoreAllMocks());

  it('assinatura: a sessão sai em modo subscription, com o intervalo do plano', async () => {
    const create = jest
      .spyOn(provider.client.checkout.sessions, 'create')
      .mockResolvedValue({ id: 'cs', url: 'https://stripe/cs' } as never);
    await provider.createCheckout(input(monthly));
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      mode: 'subscription',
      subscription_data: { metadata: { paymentId: 'pay-1' } },
      line_items: [{ price_data: { recurring: { interval: 'month' } } }],
    });
  });

  it('sessão sem URL é erro', async () => {
    jest
      .spyOn(provider.client.checkout.sessions, 'create')
      .mockResolvedValue({ id: 'cs' } as never);
    await expect(provider.createCheckout(input())).rejects.toThrow('payments.providerFailed');
  });

  it('sem cabeçalho de assinatura: recusa', async () => {
    await expect(provider.handleWebhook(webhook({}))).rejects.toThrow('payments.invalidWebhook');
  });

  it('Pix/boleto ainda não pago: espera; quando pago (async), libera', async () => {
    const session = { id: 'cs', metadata: { paymentId: 'pay-1' }, amount_total: 9900 };
    await expect(
      provider.handleWebhook(
        signed({
          type: 'checkout.session.completed',
          data: { object: { ...session, payment_status: 'unpaid' } },
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      provider.handleWebhook(
        signed({
          type: 'checkout.session.async_payment_succeeded',
          data: { object: { ...session, payment_status: 'paid' } },
        }),
      ),
    ).resolves.toEqual([
      { type: 'payment.paid', paymentId: 'pay-1', amount: 9900, providerRef: 'cs' },
    ]);
  });

  it('sessão sem o id da compra: ignora', async () => {
    await expect(
      provider.handleWebhook(
        signed({
          type: 'checkout.session.completed',
          data: { object: { payment_status: 'paid' } },
        }),
      ),
    ).resolves.toEqual([]);
  });

  it('renovação (invoice.paid): relê a assinatura na Stripe', async () => {
    jest.spyOn(provider.client.subscriptions, 'retrieve').mockResolvedValue(sub() as never);
    const events = await provider.handleWebhook(
      signed({
        type: 'invoice.paid',
        data: { object: { parent: { subscription_details: { subscription: 'sub_1' } } } },
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: 'subscription.updated',
        providerSubscriptionId: 'sub_1',
        status: 'active',
        currentPeriodEnd: new Date(1_800_000_000 * 1000),
      }),
    ]);
    await expect(
      provider.handleWebhook(signed({ type: 'invoice.paid', data: { object: { parent: null } } })),
    ).resolves.toEqual([]);
  });

  it.each([
    ['trialing', 'active'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['incomplete_expired', 'canceled'],
  ])('status da Stripe %s → %s', async (stripeStatus, status) => {
    const [event] = await provider.handleWebhook(
      signed({
        type: 'customer.subscription.updated',
        data: { object: sub({ status: stripeStatus, items: { data: [] } }) },
      }),
    );
    expect(event).toMatchObject({ status, currentPeriodEnd: null });
  });

  it('reembolso total: acha a compra pelo payment intent', async () => {
    jest
      .spyOn(provider.client.paymentIntents, 'retrieve')
      .mockResolvedValue({ metadata: { paymentId: 'pay-1' } } as never);
    await expect(
      provider.handleWebhook(
        signed({
          type: 'charge.refunded',
          data: { object: { refunded: true, payment_intent: 'pi_1' } },
        }),
      ),
    ).resolves.toEqual([{ type: 'payment.refunded', paymentId: 'pay-1' }]);
    await expect(
      provider.handleWebhook(
        signed({
          type: 'charge.refunded',
          data: { object: { refunded: false, payment_intent: 'pi_1' } },
        }),
      ),
    ).resolves.toEqual([]);
  });

  it('evento que não interessa: nada', async () => {
    await expect(
      provider.handleWebhook(signed({ type: 'customer.created', data: { object: {} } })),
    ).resolves.toEqual([]);
  });

  it('confirm: sem a sessão, nada; com ela, lê da Stripe', async () => {
    await expect(provider.confirm(payment({ providerRef: null }))).resolves.toEqual([]);
    jest.spyOn(provider.client.checkout.sessions, 'retrieve').mockResolvedValue({
      id: 'cs',
      payment_status: 'paid',
      client_reference_id: 'pay-1',
      amount_total: 9900,
    } as never);
    await expect(provider.confirm(payment())).resolves.toEqual([
      expect.objectContaining({ type: 'payment.paid', paymentId: 'pay-1' }),
    ]);
  });
});

// ---------------------------------------------------------------- InfinitePay

describe('InfinitePayProvider', () => {
  const make = (reply: Parameters<typeof fakeFetch>[0]) => {
    const fetch = fakeFetch(reply);
    const provider = new InfinitePayProvider({
      handle: 'loja',
      tokenFor: (id) => `token-${id}`,
      fetch: fetch.fn,
    });
    return { provider, calls: fetch.calls };
  };

  it('sem webhookUrl configurada: o link sai sem o aviso (a volta do checkout confirma)', async () => {
    const { provider, calls } = make(() => ({ body: { link: 'https://pay/x', slug: 's1' } }));
    const result = await provider.createCheckout({ ...input(), webhookUrl: 'https://api/hook' });
    expect(result).toEqual({ url: 'https://pay/x', providerRef: 's1' });
    expect(JSON.parse(calls[0]?.init?.body as string).webhook_url).toBe(
      'https://api/hook?token=token-pay-1',
    );
  });

  it('resposta sem link, ou erro da InfinitePay: falha clara', async () => {
    await expect(make(() => ({ body: {} })).provider.createCheckout(input())).rejects.toThrow(
      'payments.providerFailed',
    );
    await expect(
      make(() => ({ status: 500, body: {} })).provider.createCheckout(input()),
    ).rejects.toThrow('payments.providerFailed');
  });

  it('webhook que não é JSON, ou sem o pedido: recusa', async () => {
    const { provider } = make(() => ({ body: {} }));
    await expect(provider.handleWebhook(webhook('não é json'))).rejects.toThrow('invalidWebhook');
    await expect(provider.handleWebhook(webhook({}, { query: { token: 'x' } }))).rejects.toThrow(
      'invalidWebhook',
    );
    await expect(
      provider.handleWebhook(webhook({ order_nsu: 'pay-1' }, { query: {} })),
    ).rejects.toThrow('invalidWebhook');
  });

  it('confirm sem os dados da volta: não consulta', async () => {
    const { provider, calls } = make(() => ({ body: {} }));
    await expect(provider.confirm(payment(), {})).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- AbacatePay

describe('AbacatePayProvider', () => {
  const make = (reply: Parameters<typeof fakeFetch>[0]) => {
    const fetch = fakeFetch(reply);
    const provider = new AbacatePayProvider({
      apiKey: 'key',
      webhookSecret: 'seg',
      products: { 'pro-lifetime': 'prod_life', 'pro-monthly': 'prod_month' },
      fetch: fetch.fn,
    });
    return { provider, calls: fetch.calls };
  };
  const signed = (body: unknown) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return webhook(raw, {
      query: { webhookSecret: 'seg' },
      headers: {
        'x-webhook-signature': createHmac('sha256', ABACATEPAY_PUBLIC_KEY)
          .update(raw)
          .digest('base64'),
      },
    });
  };

  it('só atende o plano que tem produto cadastrado', () => {
    const { provider } = make(() => ({ body: {} }));
    expect(provider.supportsPlan(life)).toBe(true);
    expect(provider.supportsPlan({ ...life, id: 'outro' })).toBe(false);
  });

  it('plano sem produto, ou resposta incompleta: erro', async () => {
    const { provider } = make(() => ({ body: { data: {} } }));
    await expect(
      provider.createCheckout({ ...input(), plan: { ...life, id: 'outro' } }),
    ).rejects.toThrow('payments.providerUnavailable');
    await expect(provider.createCheckout(input())).rejects.toThrow('payments.providerFailed');
  });

  it('erro da AbacatePay (mesmo com HTTP 200 e "error"): falha clara', async () => {
    const { provider } = make(() => ({ body: { error: 'Produto inválido' } }));
    await expect(provider.createCheckout(input())).rejects.toThrow('payments.providerFailed');
  });

  it('assinado, mas não é JSON: recusa', async () => {
    const { provider } = make(() => ({ body: {} }));
    await expect(provider.handleWebhook(signed('nao-json'))).rejects.toThrow('invalidWebhook');
    await expect(provider.handleWebhook({ ...signed({}), headers: {} })).rejects.toThrow(
      'invalidWebhook',
    );
  });

  it('reembolso, renovação e cancelamento da assinatura', async () => {
    const { provider } = make(() => ({ body: {} }));
    await expect(
      provider.handleWebhook(signed({ event: 'checkout.refunded', data: { externalId: 'pay-1' } })),
    ).resolves.toEqual([{ type: 'payment.refunded', paymentId: 'pay-1' }]);
    await expect(
      provider.handleWebhook(signed({ event: 'subscription.renewed', data: { id: 'subs_9' } })),
    ).resolves.toEqual([
      expect.objectContaining({ providerSubscriptionId: 'subs_9', status: 'active' }),
    ]);
    await expect(
      provider.handleWebhook(
        signed({ event: 'subscription.cancelled', data: { subscriptionId: 'subs_9' } }),
      ),
    ).resolves.toEqual([expect.objectContaining({ status: 'canceled' })]);
  });

  it('evento sem os dados esperados, ou desconhecido: nada', async () => {
    const { provider } = make(() => ({ body: {} }));
    for (const body of [
      { event: 'subscription.renewed', data: {} },
      { event: 'checkout.completed', data: {} },
      { event: 'checkout.refunded', data: {} },
      { event: 'payout.completed', data: {} },
    ]) {
      await expect(provider.handleWebhook(signed(body))).resolves.toEqual([]);
    }
  });

  it('confirm: consulta a rota certa e só libera com status PAID', async () => {
    let status = 'PENDING';
    const { provider, calls } = make(() => ({ body: { data: { status, paidAmount: 9900 } } }));
    await expect(provider.confirm(payment({ providerRef: null }))).resolves.toEqual([]);
    await expect(provider.confirm(payment())).resolves.toEqual([]);
    status = 'PAID';
    await expect(provider.confirm(payment({ kind: 'subscription' }))).resolves.toEqual([
      { type: 'payment.paid', paymentId: 'pay-1', amount: 9900 },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.abacatepay.com/v2/checkouts/get?id=ref-1',
      'https://api.abacatepay.com/v2/subscriptions/checkouts/get?id=ref-1',
    ]);
  });

  it('cancelar: chama a AbacatePay e já devolve cancelada', async () => {
    const { provider, calls } = make(() => ({ body: { data: {} } }));
    const events = await provider.cancelSubscription({
      providerSubscriptionId: 'subs_9',
    } as Subscription);
    expect(events).toEqual([expect.objectContaining({ status: 'canceled' })]);
    expect(calls[0]?.url).toBe('https://api.abacatepay.com/v2/subscriptions/cancel');
  });
});
