import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { session } from '../auth/session';
import { json } from '../test/fetch-mock';
import { lastBody, makeUser, renderApp } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

/** Sem sessão salva: a API recusa o refresh e o app abre como visitante. */
const anonymous = {
  'POST /api/v1/auth/refresh': () =>
    json(401, { statusCode: 401, code: 'auth.invalidRefreshToken', message: '' }),
};

/** Um JWT de mentira com o e-mail no payload (o front só lê para mostrar). */
const token = `x.${btoa(JSON.stringify({ email: 'ana@exemplo.com.br' }))}.y`;
const tokens = { accessToken: 'a', refreshToken: 'r' };

describe('login por link', () => {
  it('pedir o link: manda só o e-mail e mostra a resposta da API (nenhuma sessão aberta)', async () => {
    const fetch = renderApp('/login', makeUser(), {
      ...anonymous,
      'POST /api/v1/auth/magic-link': () =>
        json(200, { message: 'If this email has an account, the link is on its way.' }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Email me a sign-in link' }));
    await userEvent.type(screen.getByLabelText('Email'), 'ana@exemplo.com.br');
    await userEvent.click(screen.getByRole('button', { name: 'Send link' }));

    expect(await screen.findByText(/the link is on its way/)).toBeInTheDocument();
    expect(await lastBody(fetch, 'POST', '/api/v1/auth/magic-link')).toEqual({
      email: 'ana@exemplo.com.br',
    });
    expect(session.hasSession()).toBe(false);
  });

  it('a tela do link só entra com um clique (filtros de e-mail não gastam o link)', async () => {
    const user = makeUser();
    const fetch = renderApp(`/magic-link?token=${token}`, user, {
      ...anonymous,
      'POST /api/v1/auth/magic-link/verify': () => json(200, { ...tokens, user }),
    });

    expect(await screen.findByText('You will sign in as ana@exemplo.com.br.')).toBeVisible();
    const verified = () =>
      fetch.mock.calls.some(([req]) =>
        String(req instanceof Request ? req.url : req).endsWith('/magic-link/verify'),
      );
    expect(verified()).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Hi, Jane' })).toBeInTheDocument();
    expect(await lastBody(fetch, 'POST', '/api/v1/auth/magic-link/verify')).toEqual({ token });
  });

  it('com 2FA, o link leva ao passo do código', async () => {
    renderApp(`/magic-link?token=${token}`, makeUser(), {
      ...anonymous,
      'POST /api/v1/auth/magic-link/verify': () =>
        json(200, { twoFactorRequired: true, twoFactorToken: 'challenge', expiresIn: 300 }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Two-step verification')).toBeInTheDocument();
    expect(session.hasSession()).toBe(false);
  });
});

describe('convidado sem senha', () => {
  it('é levado a criar a senha antes de usar o painel', async () => {
    const user = makeUser();
    const fetch = renderApp('/dashboard', user, {
      'GET /api/v1/users/me/identities': () => json(200, { hasPassword: false, identities: [] }),
      'POST /api/v1/auth/password/set': () => json(200, tokens),
    });

    expect(await screen.findByRole('heading', { name: 'Create your password' })).toBeVisible();

    await userEvent.type(screen.getByLabelText('New password'), 'MinhaSenha1');
    await userEvent.type(screen.getByLabelText('Confirm the new password'), 'MinhaSenha1');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await lastBody(fetch, 'POST', '/api/v1/auth/password/set')).toEqual({
      newPassword: 'MinhaSenha1',
    });
  });

  it('conta do Google/Apple sem senha NÃO é obrigada a criar uma', async () => {
    renderApp('/dashboard', makeUser(), {
      'GET /api/v1/users/me/identities': () =>
        json(200, {
          hasPassword: false,
          identities: [
            { provider: 'google', email: 'jane@exemplo.com.br', createdAt: '2026-01-01' },
          ],
        }),
      'GET /api/v1/users/me/sessions': () => json(200, []),
    });

    expect(await screen.findByRole('heading', { name: 'Hi, Jane' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Create your password' })).not.toBeInTheDocument();
  });
});
