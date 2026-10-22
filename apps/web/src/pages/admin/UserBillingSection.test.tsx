import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '../../test/fetch-mock';
import { lastBody, makeUser, renderApp } from '../../test/render';

const target = makeUser({ id: '22222222-2222-4222-8222-222222222222', name: 'Ana Souza' });
const base = `/api/v1/users/${target.id}`;
const at = '2026-10-01T12:00:00.000Z';

const subscription = (extra: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  planId: 'pro-monthly',
  provider: 'stripe',
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-11-01T12:00:00.000Z',
  canceledAt: null,
  createdAt: at,
  cancelOptions: ['period_end', 'now', 'now_refund'],
  ...extra,
});
const payment = (extra: Record<string, unknown> = {}) => ({
  id: '44444444-4444-4444-8444-444444444444',
  planId: 'pro-lifetime',
  kind: 'one_time',
  provider: 'infinitepay',
  status: 'paid',
  amount: 9900,
  currency: 'BRL',
  paidAt: at,
  createdAt: at,
  refund: 'manual',
  ...extra,
});
const billing = (extra: Record<string, unknown> = {}) => ({
  plan: 'free',
  lifetime: false,
  grant: null,
  subscription: null,
  payments: [],
  ...extra,
});

function open(billingBody: unknown, routes: Record<string, () => Response> = {}) {
  return renderApp(`/admin/users/${target.id}`, makeUser({ role: 'admin' }), {
    [`GET ${base}`]: () => json(200, target),
    [`GET ${base}/sessions`]: () => json(200, []),
    [`GET ${base}/login-methods`]: () =>
      json(200, { hasPassword: true, identities: [], passkeys: [] }),
    [`GET ${base}/billing`]: () => json(200, billingBody),
    'GET /api/v1/payments/plans': () => json(200, { plans: [], providers: [] }),
    ...routes,
  });
}

/** A seção "Plan" do detalhe (há outras seções na tela). */
const section = async () =>
  within((await screen.findByRole('heading', { name: 'Plan' })).closest('section')!);

afterEach(() => vi.unstubAllGlobals());

describe('Plano do usuário (admin)', () => {
  it('cancela a assinatura escolhendo o jeito: agora, devolvendo a última cobrança', async () => {
    const fetch = open(billing({ plan: 'pro', subscription: subscription() }), {
      [`POST ${base}/subscriptions/33333333-3333-4333-8333-333333333333/cancel`]: () =>
        json(
          200,
          billing({ subscription: subscription({ status: 'canceled', cancelOptions: [] }) }),
        ),
    });

    const plan = await section();
    expect(await plan.findByText('Subscribes to pro-monthly')).toBeInTheDocument();
    await userEvent.click(plan.getByRole('button', { name: 'Cancel subscription' }));
    expect(screen.getByLabelText(/At the end of the paid period/)).toBeChecked();
    await userEvent.click(screen.getByLabelText('Now, refunding the last charge'));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }));

    expect(
      await lastBody(
        fetch,
        'POST',
        `${base}/subscriptions/33333333-3333-4333-8333-333333333333/cancel`,
      ),
    ).toEqual({ mode: 'now_refund' });
    expect(await plan.findByText('Subscription canceled.')).toBeInTheDocument();
  });

  it('plataforma sem reembolso de assinatura: avisa para devolver pelo painel', async () => {
    open(
      billing({
        plan: 'pro',
        subscription: subscription({ provider: 'abacatepay', cancelOptions: ['now'] }),
      }),
    );
    const plan = await section();
    await userEvent.click(await plan.findByRole('button', { name: 'Cancel subscription' }));
    expect(screen.getByText(/AbacatePay does not refund subscriptions/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/refunding/)).not.toBeInTheDocument();
  });

  it('InfinitePay: registra o reembolso feito no app dela', async () => {
    const fetch = open(billing({ plan: 'pro', lifetime: true, payments: [payment()] }), {
      [`POST ${base}/payments/44444444-4444-4444-8444-444444444444/refund`]: () =>
        json(200, billing({ payments: [payment({ status: 'refunded', refund: null })] })),
    });

    const plan = await section();
    expect(await plan.findByText('Lifetime Pro')).toBeInTheDocument();
    // vitalício: não tem cortesia a dar
    expect(plan.queryByRole('button', { name: 'Give courtesy Pro' })).not.toBeInTheDocument();
    await userEvent.click(plan.getByRole('button', { name: 'Record refund' }));
    expect(screen.getByText(/has no refund API/)).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Record refund' }),
    );

    expect(
      await lastBody(fetch, 'POST', `${base}/payments/44444444-4444-4444-8444-444444444444/refund`),
    ).toEqual({});
    expect(await plan.findByText('Refund recorded.')).toBeInTheDocument();
  });

  it('Stripe: reembolsa pela API, com o motivo', async () => {
    const fetch = open(
      billing({
        plan: 'pro',
        lifetime: true,
        payments: [payment({ provider: 'stripe', refund: 'api' })],
      }),
      {
        [`POST ${base}/payments/44444444-4444-4444-8444-444444444444/refund`]: () =>
          json(200, billing()),
      },
    );
    const plan = await section();
    await userEvent.click(await plan.findByRole('button', { name: 'Refund' }));
    await userEvent.type(screen.getByLabelText('Reason'), 'Pediu pelo suporte');
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Refund' }),
    );
    expect(
      await lastBody(fetch, 'POST', `${base}/payments/44444444-4444-4444-8444-444444444444/refund`),
    ).toEqual({
      reason: 'Pediu pelo suporte',
    });
  });

  it('cortesia: dá por 3 meses e depois encerra', async () => {
    const grant = {
      id: 'g1',
      endsAt: '2027-01-22T12:00:00.000Z',
      createdAt: at,
      reason: 'Instabilidade',
      grantedById: null,
    };
    const fetch = open(billing(), {
      [`POST ${base}/grant`]: () => json(200, billing({ plan: 'pro', grant })),
      [`DELETE ${base}/grant`]: () => json(200, billing()),
    });

    const plan = await section();
    expect(await plan.findByText('Free plan')).toBeInTheDocument();
    await userEvent.click(plan.getByRole('button', { name: 'Give courtesy Pro' }));
    await userEvent.selectOptions(screen.getByLabelText('For how long'), '3');
    const give = within(screen.getByRole('dialog')).getByRole('button', { name: 'Give' });
    expect(give).toBeDisabled(); // motivo obrigatório
    await userEvent.type(screen.getByLabelText('Reason'), 'Instabilidade');
    await userEvent.click(give);
    expect(await lastBody(fetch, 'POST', `${base}/grant`)).toEqual({
      months: 3,
      reason: 'Instabilidade',
    });

    expect(await plan.findByText(/^Instabilidade · given on/)).toBeInTheDocument();
    expect(plan.getByText('Courtesy Pro')).toBeInTheDocument();
    expect(plan.getByText(/^Ends on/)).toBeInTheDocument();
    await userEvent.click(plan.getByRole('button', { name: 'End courtesy' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'End courtesy' }),
    );
    expect(await plan.findByText('Courtesy ended.')).toBeInTheDocument();
  });

  it('sem billing:manage, a seção não aparece', async () => {
    const manager = makeUser({ role: 'manager' });
    renderApp(`/admin/users/${target.id}`, manager, {
      [`GET ${base}`]: () => json(200, target),
      [`GET ${base}/sessions`]: () => json(200, []),
      [`GET ${base}/login-methods`]: () =>
        json(200, { hasPassword: true, identities: [], passkeys: [] }),
    });
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Plan' })).not.toBeInTheDocument();
  });
});
