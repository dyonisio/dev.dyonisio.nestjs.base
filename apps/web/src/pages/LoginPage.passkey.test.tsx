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

// O jsdom não tem WebAuthn: o navegador (a janela da digital/PIN) é simulado aqui
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: browser.startAuthentication,
  startRegistration: vi.fn(),
}));

const user = { id: 'u1', name: 'Jane', email: 'jane@example.com' };
const options = { challenge: 'abc', rpId: 'front.test' };
const assertion = { id: 'cred', rawId: 'cred', type: 'public-key', response: {} };

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<p>home page</p>} />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setLanguage('en');
  browser.startAuthentication.mockReset();
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
});
afterEach(() => vi.unstubAllGlobals());

describe('LoginPage — passkey', () => {
  it('enquanto o navegador espera a passkey, o botão avisa e fica desligado', async () => {
    mockFetch({
      'POST /api/v1/auth/passkeys/login/options': () =>
        json(200, { options, challengeToken: 'desafio' }),
    });
    browser.startAuthentication.mockReturnValue(new Promise(() => {}));
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    expect(await screen.findByRole('button', { name: 'Waiting for your passkey…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('entra sem e-mail nem senha: opções → navegador → API', async () => {
    const fetch = mockFetch({
      'POST /api/v1/auth/passkeys/login/options': () =>
        json(200, { options, challengeToken: 'desafio' }),
      'POST /api/v1/auth/passkeys/login': () =>
        json(200, { accessToken: 'a', refreshToken: 'r', user }),
    });
    browser.startAuthentication.mockResolvedValue(assertion);
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    expect(await screen.findByText('home page')).toBeInTheDocument();
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
    const login = requestOf(fetch.mock.calls.at(-1)!);
    expect(await login.json()).toEqual({ challengeToken: 'desafio', response: assertion });
    expect(session.hasSession()).toBe(true);
  });

  it('cancelar no navegador não é erro: continua na tela, sem aviso', async () => {
    const fetch = mockFetch({
      'POST /api/v1/auth/passkeys/login/options': () =>
        json(200, { options, challengeToken: 'desafio' }),
    });
    browser.startAuthentication.mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }),
    );
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled();
  });

  it('falha do navegador mostra o motivo e o detalhe técnico', async () => {
    // o erro completo vai para o console de propósito (diagnóstico); aqui não precisa poluir o log
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch({
      'POST /api/v1/auth/passkeys/login/options': () =>
        json(200, { options, challengeToken: 'desafio' }),
    });
    browser.startAuthentication.mockRejectedValue(
      Object.assign(new Error('The RP ID "front.test" is invalid for this domain'), {
        name: 'SecurityError',
        code: 'ERROR_INVALID_RP_ID',
      }),
    );
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This site's address does not match the passkey domain");
    expect(alert).toHaveTextContent('SecurityError: ERROR_INVALID_RP_ID'); // detalhe para suporte
  });
});
