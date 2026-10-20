import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { session } from '../auth/session';
import { I18nProvider } from '../i18n/I18nProvider';
import { setLanguage } from '../i18n/language';
import { json, mockFetch } from '../test/fetch-mock';
import { ReauthDialog } from './Reauth';

// O jsdom não tem WebAuthn: a janela da digital/PIN é simulada aqui
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: browser.startAuthentication,
  startRegistration: vi.fn(),
}));

const assertion = { id: 'cred', rawId: 'cred', type: 'public-key', response: {} };

function renderDialog(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(
    <I18nProvider>
      <AuthProvider>
        <ReauthDialog
          title="Delete account"
          confirmLabel="Delete"
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />
      </AuthProvider>
    </I18nProvider>,
  );
  return onConfirm;
}

beforeEach(() => {
  setLanguage('en');
  browser.startAuthentication.mockReset();
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  // Logada: as formas de login (tem passkey?) são da pessoa da sessão
  session.start({
    accessToken: 'a',
    user: { id: 'u1', name: 'Jane', email: 'jane@example.com', twoFactorEnabledAt: null } as never,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ReauthDialog — confirmar com passkey', () => {
  it('com passkey na conta: confirma sem senha, mandando a prova da passkey', async () => {
    mockFetch({
      'GET /api/v1/users/me/identities': () =>
        json(200, { hasPassword: true, identities: [], passkeys: 1 }),
      'POST /api/v1/auth/passkeys/reauth/options': () =>
        json(200, { options: { challenge: 'abc' }, challengeToken: 'desafio' }),
    });
    browser.startAuthentication.mockResolvedValue(assertion);
    const onConfirm = renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Confirm with a passkey' }));

    expect(onConfirm).toHaveBeenCalledWith({
      passkey: { challengeToken: 'desafio', response: assertion },
    });
  });

  it('cancelar na janela do navegador não confirma nada', async () => {
    mockFetch({
      'GET /api/v1/users/me/identities': () =>
        json(200, { hasPassword: true, identities: [], passkeys: 1 }),
      'POST /api/v1/auth/passkeys/reauth/options': () =>
        json(200, { options: { challenge: 'abc' }, challengeToken: 'desafio' }),
    });
    browser.startAuthentication.mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }),
    );
    const onConfirm = renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Confirm with a passkey' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sem passkey na conta: só a senha', async () => {
    mockFetch({
      'GET /api/v1/users/me/identities': () =>
        json(200, { hasPassword: true, identities: [], passkeys: 0 }),
    });
    renderDialog();

    expect(await screen.findByLabelText('Current password')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm with a passkey' }),
    ).not.toBeInTheDocument();
  });
});
