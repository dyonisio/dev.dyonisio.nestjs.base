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

  async function createUser(email: string, role?: 'admin'): Promise<string> {
    const { UsersService } = await import('../src/users/users.service');
    const { Role } = await import('../src/common/enums/role.enum');
    await app
      .get(UsersService)
      .create(
        { name: 'Ana', email, password: 'Senha123', ...(role ? { role: Role.ADMIN } : {}) },
        { emailVerified: true },
      );
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

      // já comprou: não compra de novo, nem assina o mensal (o Pro já é dele para sempre)
      expect((await checkout(token, 'pro-lifetime', 'stripe').expect(400)).body.code).toBe(
        'payments.alreadyPurchased',
      );
      expect((await checkout(token, 'pro-monthly', 'stripe').expect(400)).body.code).toBe(
        'payments.alreadyLifetime',
      );
      expect(await billing(token)).toMatchObject({ plan: 'pro', lifetime: true });
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
    it('pagamento único: cria o produto do plano; webhook com secret e assinatura', async () => {
      const token = await createUser('abacate@test.com');
      fakeApi = (url) =>
        url.endsWith('/products/create')
          ? { data: { id: 'prod_life' } }
          : { data: { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1' } };

      const res = await checkout(token, 'pro-lifetime', 'abacatepay').expect(200);
      expect(res.body.url).toBe('https://app.abacatepay.com/pay/bill_1');
      expect(calls.find((c) => c.url.endsWith('/v2/products/create'))!.body).toMatchObject({
        price: 9900,
        currency: 'BRL',
      });
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
          : url.endsWith('/products/create')
            ? { data: { id: 'prod_month' } }
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

  describe('planos pelo admin', () => {
    const publicPlans = async () =>
      (await http().get('/api/v1/payments/plans').expect(200)).body.plans as {
        id: string;
        amount: number;
        providers: string[];
      }[];

    it('só com plans:manage', async () => {
      const token = await createUser('sem-permissao@test.com');
      await as(token, http().get('/api/v1/admin/plans')).expect(403);
      await as(token, http().patch('/api/v1/admin/plans/pro-lifetime'))
        .send({ amount: 100 })
        .expect(403);
    });

    it('preço novo vale para a próxima compra; a AbacatePay ganha outro produto', async () => {
      const admin = await createUser('admin-planos@test.com', 'admin');
      const res = await as(admin, http().patch('/api/v1/admin/plans/pro-lifetime'))
        .send({ amount: 14900, namePt: 'Pro para sempre' })
        .expect(200);
      expect(res.body).toMatchObject({
        amount: 14900,
        namePt: 'Pro para sempre',
        kind: 'one_time',
      });
      expect(res.body).not.toHaveProperty('providerProducts');
      expect((await publicPlans()).find((p) => p.id === 'pro-lifetime')?.amount).toBe(14900);

      const token = await createUser('preco-novo@test.com');
      fakeApi = () => ({ url: 'https://checkout.infinitepay.io/novo' });
      const buy = await checkout(token, 'pro-lifetime', 'infinitepay').expect(200);
      expect(calls.at(-1)!.body).toMatchObject({ items: [{ price: 14900 }] });
      expect((await payments.findOneByOrFail({ id: buy.body.paymentId })).amount).toBe(14900);

      let products = 0;
      fakeApi = (url) =>
        url.endsWith('/products/create')
          ? { data: { id: `prod_${++products}` } }
          : { data: { id: 'bill_n', url: 'https://app.abacatepay.com/pay/bill_n' } };
      await checkout(token, 'pro-lifetime', 'abacatepay').expect(200);
      await checkout(token, 'pro-lifetime', 'abacatepay').expect(200);
      expect(products).toBe(1); // um produto por preço, não por compra
      expect(calls.filter((c) => c.url.endsWith('/products/create')).at(-1)!.body).toMatchObject({
        price: 14900,
      });

      const log = await audit.findOneByOrFail({ action: 'plan.updated' as never });
      expect(log).toMatchObject({ targetType: 'plan', targetId: 'pro-lifetime' });
      expect(log.metadata).toMatchObject({ from: 9900, to: 14900 });
    });

    it('cria plano, recusa id repetido ou inválido, e tira de venda', async () => {
      const admin = await createUser('admin-novo-plano@test.com', 'admin');
      const plan = {
        id: 'pro-yearly',
        kind: 'subscription',
        interval: 'year',
        amount: 29900,
        nameEn: 'Pro, yearly',
        namePt: 'Pro anual',
        sortOrder: 5,
      };
      await as(admin, http().post('/api/v1/admin/plans')).send(plan).expect(201);
      expect((await publicPlans()).find((p) => p.id === 'pro-yearly')?.providers).toEqual([
        'stripe',
        'abacatepay',
      ]);
      expect(
        (await as(admin, http().post('/api/v1/admin/plans')).send(plan).expect(409)).body.code,
      ).toBe('payments.planExists');
      await as(admin, http().post('/api/v1/admin/plans'))
        .send({ ...plan, id: 'Com Espaço' })
        .expect(400);
      // tipo e ciclo não mudam depois de criado
      await as(admin, http().patch('/api/v1/admin/plans/pro-yearly'))
        .send({ kind: 'one_time' })
        .expect(400);

      await as(admin, http().patch('/api/v1/admin/plans/pro-yearly'))
        .send({ active: false })
        .expect(200);
      expect((await publicPlans()).map((p) => p.id)).not.toContain('pro-yearly');
      const token = await createUser('fora-de-venda@test.com');
      await checkout(token, 'pro-yearly', 'stripe').expect(404);

      const all = (await as(admin, http().get('/api/v1/admin/plans')).expect(200)).body as {
        id: string;
        active: boolean;
      }[];
      expect(all.find((p) => p.id === 'pro-yearly')).toMatchObject({ active: false });
      await as(admin, http().patch('/api/v1/admin/plans/nao-existe'))
        .send({ amount: 100 })
        .expect(404);
    });
  });

  describe('admin: o plano de um usuário', () => {
    let admin: string;
    let subscriptions: Repository<
      import('../src/payments/entities/subscription.entity').Subscription
    >;

    const idOf = async (token: string) =>
      (await as(token, http().get('/api/v1/users/me')).expect(200)).body.id as string;
    const adminBilling = async (userId: string) =>
      (await as(admin, http().get(`/api/v1/users/${userId}/billing`)).expect(200)).body;
    /** Um usuário com uma compra já paga (sem passar pela plataforma). */
    async function buyer(email: string, extra: Json = {}) {
      const token = await createUser(email);
      const userId = await idOf(token);
      const payment = await payments.save(
        payments.create({
          userId,
          planId: 'pro-lifetime',
          kind: 'one_time',
          provider: 'infinitepay',
          status: 'paid',
          amount: 9900,
          currency: 'BRL',
          paidAt: new Date(),
          ...extra,
        }),
      );
      return { token, userId, payment };
    }
    async function subscriber(email: string, provider: string, providerSubscriptionId: string) {
      const { token, userId, payment } = await buyer(email, {
        planId: 'pro-monthly',
        kind: 'subscription',
        provider,
        amount: 2990,
      });
      const sub = await subscriptions.save(
        subscriptions.create({
          userId,
          planId: 'pro-monthly',
          provider,
          providerSubscriptionId,
          status: 'active',
          cancelAtPeriodEnd: false,
        }),
      );
      return { token, userId, payment, sub };
    }

    beforeAll(async () => {
      admin = await createUser('admin-billing@test.com', 'admin');
      const { Subscription } = await import('../src/payments/entities/subscription.entity');
      subscriptions = app.get(getRepositoryToken(Subscription));
    });

    it('só com billing:manage', async () => {
      const token = await createUser('curioso@test.com');
      await as(token, http().get(`/api/v1/users/${await idOf(token)}/billing`)).expect(403);
    });

    it('cortesia: dá, estende, a pessoa vê, e revoga', async () => {
      const token = await createUser('cortesia@test.com');
      const userId = await idOf(token);
      const grant = (body: Json) =>
        as(admin, http().post(`/api/v1/users/${userId}/grant`)).send(body);

      await grant({ reason: 'sem período' }).expect(400);
      await grant({ months: 1, endsAt: '2099-01-01T00:00:00Z', reason: 'os dois' }).expect(400);
      await grant({ endsAt: '2020-01-01T00:00:00Z', reason: 'no passado' }).expect(400);

      const first = (await grant({ months: 2, reason: 'Instabilidade de outubro' }).expect(200))
        .body;
      expect(first).toMatchObject({ plan: 'pro', grant: { reason: 'Instabilidade de outubro' } });
      const end = new Date(first.grant.endsAt as string).getTime();
      expect(end - Date.now()).toBeGreaterThan(58 * 86_400_000);

      // de novo: estende a mesma, a partir do fim
      const second = (await grant({ months: 1, reason: 'mais um' }).expect(200)).body;
      expect(second.grant.id).toBe(first.grant.id);
      expect(new Date(second.grant.endsAt as string).getTime()).toBeGreaterThan(end);

      const mine = await billing(token);
      expect(mine).toMatchObject({ plan: 'pro', lifetime: false });
      expect(mine.grant).not.toHaveProperty('reason');

      expect(
        (await as(admin, http().delete(`/api/v1/users/${userId}/grant`)).expect(200)).body,
      ).toMatchObject({ plan: 'free', grant: null });
      expect(
        (await as(admin, http().delete(`/api/v1/users/${userId}/grant`)).expect(404)).body.code,
      ).toBe('payments.grantNotFound');
      expect(await audit.count({ where: { action: 'billing.grant_given' as never } })).toBe(2);

      await as(
        admin,
        http().get('/api/v1/users/00000000-0000-4000-8000-000000000000/billing'),
      ).expect(404);
    });

    it('cortesia não é para quem tem o vitalício ou paga assinatura', async () => {
      const { userId } = await buyer('vitalicio-cortesia@test.com');
      expect(
        (
          await as(admin, http().post(`/api/v1/users/${userId}/grant`))
            .send({ months: 1, reason: 'x' })
            .expect(400)
        ).body.code,
      ).toBe('payments.alreadyLifetime');
      const other = await subscriber('assinante-cortesia@test.com', 'stripe', 'sub_cortesia');
      expect(
        (
          await as(admin, http().post(`/api/v1/users/${other.userId}/grant`))
            .send({ months: 1, reason: 'x' })
            .expect(400)
        ).body.code,
      ).toBe('payments.grantHasSubscription');
    });

    it('reembolso: InfinitePay só registra; Stripe e AbacatePay devolvem pela API', async () => {
      const refund = (userId: string, paymentId: string, reason?: string) =>
        as(admin, http().post(`/api/v1/users/${userId}/payments/${paymentId}/refund`)).send(
          reason ? { reason } : {},
        );

      // InfinitePay: sem API de reembolso
      const infinite = await buyer('reembolso-infinite@test.com');
      expect((await adminBilling(infinite.userId)).payments[0]).toMatchObject({ refund: 'manual' });
      const after = (await refund(infinite.userId, infinite.payment.id).expect(200)).body;
      expect(after).toMatchObject({ plan: 'free', lifetime: false });
      expect(after.payments[0]).toMatchObject({ status: 'refunded', refund: null });
      expect((await refund(infinite.userId, infinite.payment.id).expect(400)).body.code).toBe(
        'payments.notRefundable',
      );

      // Stripe
      const viaStripe = await buyer('reembolso-stripe@test.com', {
        provider: 'stripe',
        providerRef: 'cs_admin',
      });
      jest
        .spyOn(stripe.client.checkout.sessions, 'retrieve')
        .mockResolvedValue({ payment_intent: 'pi_admin' } as never);
      const stripeRefund = jest
        .spyOn(stripe.client.refunds, 'create')
        .mockResolvedValue({} as never);
      await refund(viaStripe.userId, viaStripe.payment.id, 'Pediu reembolso').expect(200);
      expect(stripeRefund.mock.calls[0]?.[0]).toMatchObject({ payment_intent: 'pi_admin' });
      expect((await payments.findOneByOrFail({ id: viaStripe.payment.id })).status).toBe(
        'refunded',
      );

      // AbacatePay
      const viaAbacate = await buyer('reembolso-abacate@test.com', {
        provider: 'abacatepay',
        providerRef: 'bill_admin',
      });
      fakeApi = () => ({ data: { status: 'COMPLETE' } });
      await refund(viaAbacate.userId, viaAbacate.payment.id).expect(200);
      expect(calls.at(-1)).toMatchObject({
        url: 'https://api.abacatepay.com/v2/checkouts/refund',
        body: { id: 'bill_admin' },
      });

      const log = await audit.findOneByOrFail({
        action: 'billing.payment_refunded' as never,
        targetId: infinite.userId,
      });
      expect(log.metadata).toMatchObject({ manual: true, amount: 9900 });
      await refund(infinite.userId, viaStripe.payment.id).expect(404); // compra de outra pessoa
    });

    it('cancelar na Stripe: fim do período, ou agora devolvendo a primeira cobrança', async () => {
      const { userId, payment, sub } = await subscriber(
        'cancela-stripe@test.com',
        'stripe',
        'sub_adm',
      );
      const cancel = (mode: string) =>
        as(admin, http().post(`/api/v1/users/${userId}/subscriptions/${sub.id}/cancel`)).send({
          mode,
        });
      const stripeSub = (extra: Json = {}) => ({
        id: 'sub_adm',
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: null,
        metadata: { paymentId: payment.id },
        items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86_400 }] },
        ...extra,
      });

      expect((await adminBilling(userId)).subscription.cancelOptions).toEqual([
        'period_end',
        'now',
        'now_refund',
      ]);
      await cancel('depois').expect(400);

      jest
        .spyOn(stripe.client.subscriptions, 'update')
        .mockResolvedValue(stripeSub({ cancel_at_period_end: true }) as never);
      const atEnd = (await cancel('period_end').expect(200)).body;
      expect(atEnd.subscription).toMatchObject({ cancelAtPeriodEnd: true, status: 'active' });
      expect(atEnd.subscription.cancelOptions).toEqual(['now', 'now_refund']);

      jest
        .spyOn(stripe.client.subscriptions, 'retrieve')
        .mockResolvedValue(stripeSub({ latest_invoice: 'in_adm' }) as never);
      jest.spyOn(stripe.client.invoices, 'retrieve').mockResolvedValue({
        billing_reason: 'subscription_create',
        payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_sub_adm' } }] },
      } as never);
      const stripeRefund = jest
        .spyOn(stripe.client.refunds, 'create')
        .mockResolvedValue({} as never);
      jest
        .spyOn(stripe.client.subscriptions, 'cancel')
        .mockResolvedValue(stripeSub({ status: 'canceled' }) as never);
      const refunded = (await cancel('now_refund').expect(200)).body;
      expect(stripeRefund).toHaveBeenCalledWith({ payment_intent: 'pi_sub_adm' });
      expect(refunded).toMatchObject({ plan: 'free', subscription: { status: 'canceled' } });
      expect(refunded.subscription.cancelOptions).toEqual([]);
      expect(refunded.payments[0]).toMatchObject({ id: payment.id, status: 'refunded' });
    });

    it('cancelar na AbacatePay: só agora, sem reembolso de assinatura', async () => {
      const { userId, sub } = await subscriber(
        'cancela-abacate@test.com',
        'abacatepay',
        'subs_adm',
      );
      expect((await adminBilling(userId)).subscription.cancelOptions).toEqual(['now']);
      const cancel = (mode: string) =>
        as(admin, http().post(`/api/v1/users/${userId}/subscriptions/${sub.id}/cancel`)).send({
          mode,
        });
      expect((await cancel('now_refund').expect(400)).body.code).toBe(
        'payments.cancelModeUnavailable',
      );
      fakeApi = () => ({ data: { id: 'subs_adm', status: 'CANCELLED' } });
      expect((await cancel('now').expect(200)).body.subscription.status).toBe('canceled');
      expect(calls.at(-1)).toMatchObject({ body: { id: 'subs_adm' } });
      expect(
        await audit.count({
          where: { action: 'billing.subscription_canceled' as never, targetId: userId },
        }),
      ).toBe(1);
    });
  });

  it('webhook de plataforma desligada: 404', async () => {
    await http().post('/api/v1/payments/webhooks/mercadopago').send({}).expect(404);
  });
});
