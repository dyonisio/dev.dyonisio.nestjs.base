import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '../../test/fetch-mock';
import { lastBody, makeUser, renderApp } from '../../test/render';
import { parseCents } from './PlansPage';

const plan = (extra: Record<string, unknown> = {}) => ({
  id: 'pro-monthly',
  kind: 'subscription',
  interval: 'month',
  amount: 2990,
  currency: 'BRL',
  nameEn: 'Pro, monthly',
  namePt: 'Pro mensal',
  descriptionEn: 'Every month.',
  descriptionPt: 'Todo mês.',
  active: true,
  sortOrder: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe('Planos (/admin/plans)', () => {
  it('muda o preço de um plano', async () => {
    const fetch = renderApp('/admin/plans', makeUser({ role: 'admin' }), {
      'GET /api/v1/admin/plans': () =>
        json(200, [plan(), plan({ id: 'old', nameEn: 'Old', amount: 1000, active: false })]),
      'PATCH /api/v1/admin/plans/pro-monthly': () => json(200, plan({ amount: 3990 })),
    });

    expect(await screen.findByText(/R\$\s?29\.90 \/ month/)).toBeInTheDocument();
    expect(screen.getByText('Off sale')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit pro-monthly' }));
    const price = screen.getByLabelText('Price (R$)');
    expect(price).toHaveValue('29.90');
    await userEvent.clear(price);
    await userEvent.type(price, '39.90');
    expect(screen.getByText(/only for purchases from now on/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await lastBody(fetch, 'PATCH', '/api/v1/admin/plans/pro-monthly')).toMatchObject({
      amount: 3990,
      namePt: 'Pro mensal',
      active: true,
    });
  });

  it('cria uma assinatura anual', async () => {
    const fetch = renderApp('/admin/plans', makeUser({ role: 'admin' }), {
      'GET /api/v1/admin/plans': () => json(200, []),
      'POST /api/v1/admin/plans': () => json(201, plan({ id: 'pro-yearly' })),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'New plan' }));
    await userEvent.type(screen.getByLabelText('Id'), 'pro-yearly');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'subscription');
    await userEvent.selectOptions(screen.getByLabelText('Billing cycle'), 'year');
    await userEvent.type(screen.getByLabelText('Price (R$)'), 'abc');
    expect(screen.getByText('Use a price like 29.90')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Price (R$)'));
    await userEvent.type(screen.getByLabelText('Price (R$)'), '299');
    await userEvent.type(screen.getByLabelText('Name (Portuguese)'), 'Pro anual');
    await userEvent.type(screen.getByLabelText('Name (English)'), 'Pro, yearly');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await lastBody(fetch, 'POST', '/api/v1/admin/plans')).toMatchObject({
      id: 'pro-yearly',
      kind: 'subscription',
      interval: 'year',
      amount: 29900,
      nameEn: 'Pro, yearly',
    });
  });

  it('sem plans:manage, não abre', async () => {
    renderApp('/admin/plans', makeUser(), {});
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
});

describe('parseCents', () => {
  it.each([
    ['29,90', 2990],
    ['29.90', 2990],
    ['1.299,90', 129990],
    ['R$ 99', 9900],
    ['0,5', 50],
    ['abc', NaN],
    ['1,234', NaN],
    ['', NaN],
  ])('%s → %s', (text, cents) => {
    expect(parseCents(text)).toBe(cents);
  });
});
