import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { session } from '../auth/session';
import { I18nProvider } from '../i18n/I18nProvider';
import { setLanguage } from '../i18n/language';
import { json, mockFetch, requestOf } from '../test/fetch-mock';
import { LoginPage } from './LoginPage';

const user = { id: 'u1', name: 'Jane', email: 'jane@example.com' };

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<p>home page</p>} />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(password: string) {
  await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => setLanguage('en'));
afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('sem 2FA: entra direto e vai para o início', async () => {
    mockFetch({
      'POST /api/v1/auth/login': () => json(200, { accessToken: 'a', refreshToken: 'r', user }),
    });
    renderLogin();

    await fillAndSubmit('secret123');

    expect(await screen.findByText('home page')).toBeInTheDocument();
    expect(session.hasSession()).toBe(true);
  });

  it('com 2FA: pede o código e só então abre a sessão', async () => {
    const fetch = mockFetch({
      'POST /api/v1/auth/login': () =>
        json(200, { twoFactorRequired: true, twoFactorToken: 'challenge' }),
      'POST /api/v1/auth/2fa/verify': () =>
        json(200, { accessToken: 'a', refreshToken: 'r', user }),
    });
    renderLogin();

    await fillAndSubmit('secret123');

    expect(await screen.findByText('Two-step verification')).toBeInTheDocument();
    expect(session.hasSession()).toBe(false);

    await userEvent.type(screen.getByLabelText('Code'), ' 123456 ');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('home page')).toBeInTheDocument();
    const verify = requestOf(fetch.mock.calls.at(-1)!);
    expect(await verify.json()).toEqual({ twoFactorToken: 'challenge', code: '123456' });
  });

  it('mostra o erro da API (já traduzido pela própria API)', async () => {
    mockFetch({
      'POST /api/v1/auth/login': () =>
        json(401, {
          statusCode: 401,
          code: 'auth.invalidCredentials',
          message: 'Invalid email or password',
        }),
    });
    renderLogin();

    await fillAndSubmit('wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('Entrar fica desligado até e-mail e senha estarem preenchidos (nenhuma chamada à toa)', async () => {
    const fetch = mockFetch({});
    renderLogin();

    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    expect(button).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
