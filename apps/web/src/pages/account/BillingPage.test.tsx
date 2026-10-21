import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, requestOf } from '../../test/fetch-mock';
import { lastBody, makeUser, renderApp } from '../../test/render';

// Sair do site (para o checkout da plataforma) não existe no jsdom: só registra para onde iria
const external = vi.hoisted(() => ({ goToExternal: vi.fn() }));
vi.mock('../../lib/external', () => external);

const plans = {
  plans: [
    {
      id: 'pro-lifetime',
      kind: 'one_time',
      amount: 9900,
      currency: 'BRL',
      name: 'Pro, lifetime',
      description: 'Pay once.',
      providers: ['stripe', 'infinitepay'],
    },
    {
      id: 'pro-monthly',
      kind: 'subscription',
      interval: 'month',
      amount: 2990,
      currency: 'BRL',
      name: 'Pro, monthly',
      description: 'Every month.',
      providers: ['stripe'],
    },
  ],
  providers: [
    { id: 'stripe', methods: ['card'] },
    { id: 'infinitepay', methods: ['pix', 'card'] },
  ],
};
const free = { plan: 'free', lifetime: false, subscription: null, payments: [] };

afterEach(() => {
  vi.unstubAllGlobals();
  external.goToExternal.mockReset();
});

describe('Plano (/billing)', () => {
  it('com duas plataformas, a pessoa escolhe; o checkout vai para a página da escolhida', async () => {
    const fetch = renderApp('/billing', makeUser(), {
      'GET /api/v1/payments/plans': () => json(200, plans),
      'GET /api/v1/users/me/billing': () => json(200, free),
      'POST /api/v1/payments/checkout': () =>
        json(200, { url: 'https://checkout.infinitepay.io/x', paymentId: 'p1' }),
    });

    const choose = await screen.findByRole('combobox', { name: 'How to pay for Pro, lifetime' });
    expect(screen.getByText(/R\$\s?99\.00, once · Pay once\./)).toBeInTheDocument();
    await userEvent.selectOptions(choose, 'infinitepay');
    await userEvent.click(screen.getAllByRole('button', { name: 'Buy' })[0]!);

    expect(await lastBody(fetch, 'POST', '/api/v1/payments/checkout')).toEqual({
      planId: 'pro-lifetime',
      provider: 'infinitepay',
    });
    expect(external.goToExternal).toHaveBeenCalledWith('https://checkout.infinitepay.io/x');
  });

  it('com uma plataforma só, não pergunta (e não manda provider)', async () => {
    const fetch = renderApp('/billing', makeUser(), {
      'GET /api/v1/payments/plans': () => json(200, plans),
      'GET /api/v1/users/me/billing': () => json(200, free),
      'POST /api/v1/payments/checkout': () =>
        json(200, { url: 'https://checkout.stripe.com/c/1', paymentId: 'p2' }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Subscribe' }));
    expect(await lastBody(fetch, 'POST', '/api/v1/payments/checkout')).toEqual({
      planId: 'pro-monthly',
    });
  });

  it('assinante: mostra a renovação e cancela com confirmação', async () => {
    const fetch = renderApp('/billing', makeUser(), {
      'GET /api/v1/payments/plans': () => json(200, plans),
      'GET /api/v1/users/me/billing': () =>
        json(200, {
          plan: 'pro',
          lifetime: false,
          subscription: {
            id: 's1',
            planId: 'pro-monthly',
            provider: 'stripe',
            status: 'active',
            cancelAtPeriodEnd: false,
            currentPeriodEnd: '2026-11-21T12:00:00.000Z',
            canceledAt: null,
            createdAt: '2026-10-21T12:00:00.000Z',
          },
          payments: [],
        }),
      'POST /api/v1/users/me/subscriptions/s1/cancel': () => json(200, {}),
    });

    expect(await screen.findByText('You are on Pro.')).toBeInTheDocument();
    expect(screen.getByText(/Renews on/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    expect(screen.getByText(/You keep Pro until the end of the period/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel subscription' }).at(-1)!);

    const cancel = fetch.mock.calls.some(
      (c) => new URL(requestOf(c).url).pathname === '/api/v1/users/me/subscriptions/s1/cancel',
    );
    expect(cancel).toBe(true);
  });
});

describe('Plano vitalício', () => {
  const lifetimePayment = {
    id: 'p1',
    planId: 'pro-lifetime',
    kind: 'one_time',
    provider: 'stripe',
    status: 'paid',
    amount: 9900,
    currency: 'BRL',
    paidAt: '2026-10-01T12:00:00.000Z',
    createdAt: '2026-10-01T12:00:00.000Z',
  };

  it('com o vitalício, o mensal não se compra: já está incluído', async () => {
    renderApp('/billing', makeUser(), {
      'GET /api/v1/payments/plans': () => json(200, plans),
      'GET /api/v1/users/me/billing': () =>
        json(200, { plan: 'pro', lifetime: true, subscription: null, payments: [lifetimePayment] }),
    });

    expect(await screen.findByText('You have Pro for life.')).toBeInTheDocument();
    expect(screen.getByText('Already included in your lifetime Pro')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy' })).not.toBeInTheDocument();
  });

  it('assinava e comprou o vitalício: avisa para cancelar a assinatura', async () => {
    renderApp('/billing', makeUser(), {
      'GET /api/v1/payments/plans': () => json(200, plans),
      'GET /api/v1/users/me/billing': () =>
        json(200, {
          plan: 'pro',
          lifetime: true,
          subscription: {
            id: 's1',
            planId: 'pro-monthly',
            provider: 'stripe',
            status: 'active',
            cancelAtPeriodEnd: false,
            currentPeriodEnd: '2026-11-21T12:00:00.000Z',
            canceledAt: null,
            createdAt: '2026-09-21T12:00:00.000Z',
          },
          payments: [lifetimePayment],
        }),
    });

    expect(
      await screen.findByText(/Cancel this subscription so you are not charged again/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();
  });
});

describe('Volta do checkout (/billing/return)', () => {
  it('manda à API o que a plataforma pôs na URL e mostra o pagamento confirmado', async () => {
    const fetch = renderApp('/billing/return?payment=p1&transaction_nsu=tx1&slug=s1', makeUser(), {
      'POST /api/v1/payments/p1/confirm': () => json(200, { id: 'p1', status: 'paid' }),
    });

    expect(await screen.findByText('Payment confirmed. Welcome to Pro!')).toBeInTheDocument();
    expect(await lastBody(fetch, 'POST', '/api/v1/payments/p1/confirm')).toEqual({
      params: { transaction_nsu: 'tx1', slug: 's1' },
    });
  });
});
