import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

// As três plataformas ligadas só neste arquivo (os módulos são importados depois, no beforeAll)
Object.assign(process.env, {
  PAYMENT_PROVIDERS: 'stripe,infinitepay,abacatepay',
  PAYMENTS_PUBLIC_API_URL: 'http://api.test',
  STRIPE_SECRET_KEY: 'sk_test_e2e',
  STRIPE_WEBHOOK_SECRET: 'whsec_e2e',
  INFINITEPAY_HANDLE: 'loja-teste',
  ABACATEPAY_API_KEY: 'abc_dev_e2e',
  ABACATEPAY_WEBHOOK_SECRET: 'segredo-do-webhook',
  ABACATEPAY_PRODUCTS: 'pro-lifetime:prod_life,pro-monthly:prod_month',
});

type Json = Record<string, unknown>;

describe('Pagamentos (e2e)', () => {
  let app: INestApplication<App>;
  let stripe: import('../src/payments/providers/stripe.provider').StripeProvider;
  let payments: Repository<import('../src/payments/entities/payment.entity').Payment>;
  let audit: Repository<import('../src/audit/audit-log.entity').AuditLog>;
  let publicKey: string;
  /** Respostas de mentira da InfinitePay e da AbacatePay (o que o `fetch` da API recebe). */
  let fakeApi: (url: string, body: Json | undefined) => Json;
  const calls: { url: string; body: Json | undefined }[] = [];

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  async function createUser(email: string): Promise<string> {
    const { UsersService } = await import('../src/users/users.service');
    await app
      .get(UsersService)
      .create({ name: 'Ana', email, password: 'Senha123' }, { emailVerified: true });
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'Senha123' })
      .expect(200);
    return res.body.accessToken;
  }

  const checkout = (token: string, planId: string, provider?: string) =>
    as(token, http().post('/api/v1/payments/checkout')).send({ planId, provider });

  const billing = async (token: string) =>
    (await as(token, http().get('/api/v1/users/me/billing')).expect(200)).body;

  function stripeWebhook(event: Json) {
    const payload = JSON.stringify({ id: `evt_${Date.now()}`, object: 'event', ...event });
    const signature = stripe.client.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_e2e',
    });
    return http()
      .post('/api/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
  }

  function abacateWebhook(body: Json, { secret = 'segredo-do-webhook', sign = true } = {}) {
    const payload = JSON.stringify(body);
    const signature = createHmac('sha256', sign ? publicKey : 'outra-chave')
      .update(payload)
      .digest('base64');
    return http()
      .post(`/api/v1/payments/webhooks/abacatepay?webhookSecret=${secret}`)
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature)
      .send(payload);
  }

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(
      moduleRef.createNestApplication({ logger: false, rawBody: true }),
    ) as INestApplication<App>;
    await app.init();

    const { PaymentProviders } = await import('../src/payments/payment-providers');
    const { Payment } = await import('../src/payments/entities/payment.entity');
    const { AuditLog } = await import('../src/audit/audit-log.entity');
    ({ ABACATEPAY_PUBLIC_KEY: publicKey } =
      await import('../src/payments/providers/abacatepay.provider'));
    stripe = app.get(PaymentProviders).get('stripe') as typeof stripe;
    payments = app.get(getRepositoryToken(Payment));
    audit = app.get(getRepositoryToken(AuditLog));

    jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const raw = typeof init?.body === 'string' ? init.body : undefined;
      const body = raw ? (JSON.parse(raw) as Json) : undefined;
      calls.push({ url, body });
      return Promise.resolve(
        new Response(JSON.stringify(fakeApi(url, body)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  describe('planos', () => {
    it('cada plano lista só as plataformas que conseguem cobrá-lo', async () => {
      const res = await http().get('/api/v1/payments/plans').set('Accept-Language', 'pt-BR');
      const byId = Object.fromEntries(
        (res.body.plans as { id: string; providers: string[]; name: string }[]).map((p) => [
          p.id,
          p,
        ]),
      );

      expect(byId['pro-lifetime']?.providers).toEqual(['stripe', 'infinitepay', 'abacatepay']);
      // a InfinitePay não tem assinatura recorrente
      expect(byId['pro-monthly']?.providers).toEqual(['stripe', 'abacatepay']);
      expect(byId['pro-monthly']?.name).toBe('Pro mensal');
    });

    it('com mais de uma plataforma, é preciso escolher; e a escolhida precisa atender o plano', async () => {
      const token = await createUser('escolha@test.com');

      expect((await checkout(token, 'pro-lifetime').expect(400)).body.code).toBe(
        'payments.chooseProvider',
      );
      expect((await checkout(token, 'pro-monthly', 'infinitepay').expect(400)).body.code).toBe(
        'payments.providerUnavailable',
      );
      await checkout(token, 'nao-existe', 'stripe').expect(404);
    });
  });

  describe('Stripe', () => {
    let token: string;

    beforeAll(async () => {
      token = await createUser('stripe@test.com');
    });

    it('pagamento único: checkout → webhook assinado → pago (uma vez só)', async () => {
      const create = jest.spyOn(stripe.client.checkout.sessions, 'create').mockResolvedValue({
        id: 'cs_life',
        url: 'https://checkout.stripe.com/c/cs_life',
      } as never);

      const res = await checkout(token, 'pro-lifetime', 'stripe').expect(200);
      expect(res.body.url).toBe('https://checkout.stripe.com/c/cs_life');
      const params = create.mock.calls[0]?.[0];
      expect(params).toMatchObject({
        mode: 'payment',
        client_reference_id: res.body.paymentId,
        line_items: [{ price_data: { unit_amount: 9900, currency: 'brl' } }],
      });
      expect(params?.success_url).toContain(`/billing/return?payment=${res.body.paymentId}`);

      const session = {
        id: 'cs_life',
        object: 'checkout.session',
        payment_status: 'paid',
        amount_total: 9900,
        metadata: { paymentId: res.body.paymentId },
        client_reference_id: res.body.paymentId,
      };
      const event = { type: 'checkout.session.completed', data: { object: session } };
      await stripeWebhook(event).expect(200);
      await stripeWebhook(event).expect(200); // a Stripe repete avisos: não muda nada

      expect((await billing(token)).plan).toBe('pro');
      expect(
        await audit.count({ where: { action: 'payment.paid' as never, actorId: undefined } }),
      ).toBeGreaterThanOrEqual(1);
      const paid = await payments.findOneByOrFail({ id: res.body.paymentId });
      expect(paid.status).toBe('paid');

      // já comprou: não compra de novo
      expect((await checkout(token, 'pro-lifetime', 'stripe').expect(400)).body.code).toBe(
        'payments.alreadyPurchased',
      );
    });

    it('webhook sem a assinatura certa é recusado', async () => {
      await http()
        .post('/api/v1/payments/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=falsa')
        .send(JSON.stringify({ type: 'checkout.session.completed', data: {} }))
        .expect(400);
    });

    it('pago com valor menor que o plano não libera', async () => {
      const other = await createUser('stripe-barato@test.com');
      jest.spyOn(stripe.client.checkout.sessions, 'create').mockResolvedValue({
        id: 'cs_cheap',
        url: 'https://checkout.stripe.com/c/cs_cheap',
      } as never);
      const res = await checkout(other, 'pro-lifetime', 'stripe').expect(200);

      await stripeWebhook({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_cheap',
            object: 'checkout.session',
            payment_status: 'paid',
            amount_total: 100,
            metadata: { paymentId: res.body.paymentId },
          },
        },
      }).expect(200);

      expect((await payments.findOneByOrFail({ id: res.body.paymentId })).status).toBe('pending');
      expect((await billing(other)).plan).toBe('free');
    });

    it('assinatura: ativa, cancela no fim do período e termina quando a Stripe avisa', async () => {
      const subscriber = await createUser('stripe-sub@test.com');
      jest
        .spyOn(stripe.client.checkout.sessions, 'create')
        .mockResolvedValue({ id: 'cs_sub', url: 'https://checkout.stripe.com/c/cs_sub' } as never);
      const res = await checkout(subscriber, 'pro-monthly', 'stripe').expect(200);
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      const subscription = (extra: Json = {}) => ({
        id: 'sub_1',
        object: 'subscription',
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: null,
        metadata: { paymentId: res.body.paymentId },
        items: { data: [{ current_period_end: periodEnd }] },
        ...extra,
      });
      jest
        .spyOn(stripe.client.subscriptions, 'retrieve')
        .mockResolvedValue(subscription() as never);

      await stripeWebhook({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_sub',
            object: 'checkout.session',
            mode: 'subscription',
            payment_status: 'paid',
            amount_total: 2990,
            subscription: 'sub_1',
            metadata: { paymentId: res.body.paymentId },
          },
        },
      }).expect(200);

      let state = await billing(subscriber);
      expect(state.plan).toBe('pro');
      expect(state.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
      expect(new Date(state.subscription.currentPeriodEnd).getTime()).toBe(periodEnd * 1000);

      // cancelar: a Stripe mantém até o fim do período pago
      const update = jest
        .spyOn(stripe.client.subscriptions, 'update')
        .mockResolvedValue(subscription({ cancel_at_period_end: true }) as never);
      await as(
        subscriber,
        http().post(`/api/v1/users/me/subscriptions/${state.subscription.id}/cancel`),
      ).expect(200);
      expect(update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
      state = await billing(subscriber);
      expect(state).toMatchObject({ plan: 'pro', subscription: { cancelAtPeriodEnd: true } });

      // fim do período: a Stripe apaga a assinatura e avisa
      await stripeWebhook({
        type: 'customer.subscription.deleted',
        data: { object: subscription({ status: 'canceled' }) },
      }).expect(200);
      state = await billing(subscriber);
      expect(state).toMatchObject({ plan: 'free', subscription: { status: 'canceled' } });
      expect(await audit.count({ where: { action: 'subscription.canceled' as never } })).toBe(1);
    });
  });

  describe('InfinitePay', () => {
    it('cria o link com o id da compra; o webhook só vale com o código e depois do payment_check', async () => {
      const token = await createUser('infinite@test.com');
      let paid = false;
      let paidAmount = 9900;
      fakeApi = (url) =>
        url.endsWith('/links')
          ? { url: 'https://checkout.infinitepay.io/loja-teste/abc' }
          : { success: true, paid, paid_amount: paidAmount, amount: 9900 };

      const res = await checkout(token, 'pro-lifetime', 'infinitepay').expect(200);
      expect(res.body.url).toBe('https://checkout.infinitepay.io/loja-teste/abc');
      const link = calls.find((c) => c.url.endsWith('/links'))!.body!;
      expect(link).toMatchObject({
        handle: 'loja-teste',
        order_nsu: res.body.paymentId,
        items: [{ quantity: 1, price: 9900 }],
      });
      const webhookUrl = new URL(String(link.webhook_url));
      expect(webhookUrl.pathname).toBe('/api/v1/payments/webhooks/infinitepay');
      const token64 = webhookUrl.searchParams.get('token')!;

      const notify = (code: string) =>
        http()
          .post(`/api/v1/payments/webhooks/infinitepay?token=${encodeURIComponent(code)}`)
          .send({ order_nsu: res.body.paymentId, transaction_nsu: 'tx1', invoice_slug: 'slug1' });

      await notify('codigo-falso').expect(400);
      await notify(token64).expect(200); // a consulta diz que ainda não pagou
      expect((await payments.findOneByOrFail({ id: res.body.paymentId })).status).toBe('pending');

      paid = true;
      paidAmount = 500; // pagou menos: não libera
      await notify(token64).expect(200);
      expect((await payments.findOneByOrFail({ id: res.body.paymentId })).status).toBe('pending');

      // na volta do checkout, a tela manda o que a InfinitePay pôs na URL
      paidAmount = 9900;
      const confirmed = await as(
        token,
        http().post(`/api/v1/payments/${res.body.paymentId}/confirm`),
      )
        .send({ params: { transaction_nsu: 'tx1', slug: 'slug1' } })
        .expect(200);
      expect(confirmed.body.status).toBe('paid');
      const check = calls.filter((c) => c.url.endsWith('/payment_check')).at(-1)!.body;
      expect(check).toEqual({
        handle: 'loja-teste',
        order_nsu: res.body.paymentId,
        transaction_nsu: 'tx1',
        slug: 'slug1',
      });
    });

    it('a compra de outra pessoa não é de ninguém além dela', async () => {
      const owner = await createUser('dona@test.com');
      const stranger = await createUser('estranho@test.com');
      fakeApi = () => ({ url: 'https://checkout.infinitepay.io/loja-teste/x' });
      const res = await checkout(owner, 'pro-lifetime', 'infinitepay').expect(200);

      await as(stranger, http().post(`/api/v1/payments/${res.body.paymentId}/confirm`))
        .send({})
        .expect(404);
    });
  });

  describe('AbacatePay', () => {
    it('pagamento único: produto do plano; webhook com secret e assinatura', async () => {
      const token = await createUser('abacate@test.com');
      fakeApi = () => ({ data: { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1' } });

      const res = await checkout(token, 'pro-lifetime', 'abacatepay').expect(200);
      expect(res.body.url).toBe('https://app.abacatepay.com/pay/bill_1');
      const created = calls.filter((c) => c.url.endsWith('/v2/checkouts/create')).at(-1)!.body;
      expect(created).toMatchObject({
        items: [{ id: 'prod_life', quantity: 1 }],
        externalId: res.body.paymentId,
      });

      const event = {
        id: 'log_1',
        event: 'checkout.completed',
        devMode: true,
        data: { checkout: { id: 'bill_1', externalId: res.body.paymentId, paidAmount: 9900 } },
      };
      await abacateWebhook(event, { secret: 'errado' }).expect(400);
      await abacateWebhook(event, { sign: false }).expect(400);
      expect((await payments.findOneByOrFail({ id: res.body.paymentId })).status).toBe('pending');

      await abacateWebhook(event).expect(200);
      expect((await billing(token)).plan).toBe('pro');
    });

    it('assinatura: ativa pelo webhook e cancela na hora', async () => {
      const token = await createUser('abacate-sub@test.com');
      fakeApi = (url) =>
        url.endsWith('/subscriptions/cancel')
          ? { data: { id: 'subs_1', status: 'CANCELLED' } }
          : { data: { id: 'bill_sub', url: 'https://app.abacatepay.com/pay/bill_sub' } };

      const res = await checkout(token, 'pro-monthly', 'abacatepay').expect(200);
      expect(calls.at(-1)!.url).toMatch(/\/v2\/subscriptions\/create$/);

      await abacateWebhook({
        id: 'log_2',
        event: 'subscription.completed',
        data: {
          subscription: { id: 'subs_1' },
          checkout: { externalId: res.body.paymentId, paidAmount: 2990 },
        },
      }).expect(200);
      let state = await billing(token);
      expect(state).toMatchObject({ plan: 'pro', subscription: { status: 'active' } });

      await as(
        token,
        http().post(`/api/v1/users/me/subscriptions/${state.subscription.id}/cancel`),
      ).expect(200);
      expect(calls.at(-1)!.body).toEqual({ id: 'subs_1' });
      state = await billing(token);
      expect(state).toMatchObject({ plan: 'free', subscription: { status: 'canceled' } });
    });
  });

  it('webhook de plataforma desligada: 404', async () => {
    await http().post('/api/v1/payments/webhooks/mercadopago').send({}).expect(404);
  });
});
