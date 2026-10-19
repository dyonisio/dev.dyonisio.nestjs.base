import { afterEach, describe, expect, it, vi } from 'vitest';
import { session } from '../auth/session';
import { json, mockFetch, requestOf } from '../test/fetch-mock';
import { api, refreshSession } from './client';

const tokens = (n: number) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}` });
/** O que a API responde com o access token ausente ou vencido. */
const unauthorized = () => json(401, { statusCode: 401, code: 'errors.http.401', message: '' });

/** /users/me aceita só o token renovado (access-2). */
const meRoute = (req: Request) =>
  req.headers.get('Authorization') === 'Bearer access-2' ? json(200, { id: 'u1' }) : unauthorized();

afterEach(() => vi.unstubAllGlobals());

describe('cliente da API', () => {
  it('manda o token e o idioma em toda requisição', async () => {
    session.start(tokens(1));
    const fetch = mockFetch({ 'GET /api/v1/users/me': () => json(200, { id: 'u1' }) });

    await api.GET('/api/v1/users/me');

    const request = requestOf(fetch.mock.calls[0]);
    expect(request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(request.headers.get('Accept-Language')).toBeTruthy();
  });

  it('num 401 renova a sessão e repete a requisição com o token novo', async () => {
    session.start(tokens(1));
    const fetch = mockFetch({
      'GET /api/v1/users/me': meRoute,
      'POST /api/v1/auth/refresh': () => json(200, tokens(2)),
    });

    const { data } = await api.GET('/api/v1/users/me');

    expect(data).toEqual({ id: 'u1' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(session.getAccessToken()).toBe('access-2');
    expect(session.hasSession()).toBe(true);
  });

  it('vários 401 ao mesmo tempo compartilham UM refresh (o refresh token é de uso único)', async () => {
    session.start(tokens(1));
    const fetch = mockFetch({
      'GET /api/v1/users/me': meRoute,
      'POST /api/v1/auth/refresh': () => json(200, tokens(2)),
    });

    const results = await Promise.all([api.GET('/api/v1/users/me'), api.GET('/api/v1/users/me')]);

    expect(results.map((r) => r.data)).toEqual([{ id: 'u1' }, { id: 'u1' }]);
    const refreshes = fetch.mock.calls.filter((c) => requestOf(c).url.endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
  });

  it('refresh recusado encerra a sessão', async () => {
    session.start(tokens(1));
    mockFetch({
      'GET /api/v1/users/me': unauthorized,
      'POST /api/v1/auth/refresh': () =>
        json(401, { statusCode: 401, code: 'auth.invalidRefreshToken', message: '' }),
    });

    const { error } = await api.GET('/api/v1/users/me');

    expect(error).toMatchObject({ statusCode: 401 });
    expect(session.hasSession()).toBe(false);
    expect(session.getAccessToken()).toBeNull();
  });

  it('401 que não é token vencido (ex.: reauthRequired) volta direto, sem refresh', async () => {
    session.start(tokens(1));
    const fetch = mockFetch({
      'DELETE /api/v1/users/me': () =>
        json(401, { statusCode: 401, code: 'account.reauthRequired', message: 'Sign in again' }),
    });

    const { error } = await api.DELETE('/api/v1/users/me', { body: {} });

    expect(error).toMatchObject({ code: 'account.reauthRequired' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.hasSession()).toBe(true);
  });

  it('401 no login é senha errada: NÃO tenta renovar', async () => {
    session.start(tokens(1));
    const fetch = mockFetch({
      'POST /api/v1/auth/login': () =>
        json(401, { statusCode: 401, code: 'auth.invalidCredentials', message: 'Invalid' }),
    });

    const { error } = await api.POST('/api/v1/auth/login', {
      body: { email: 'a@b.com', password: 'x' },
    });

    expect(error).toMatchObject({ code: 'auth.invalidCredentials' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('modo cookie: toda chamada pede o cookie (credentials) e o refresh vai sem token no corpo', async () => {
    session.start(tokens(1));
    const fetch = mockFetch({
      'GET /api/v1/users/me': meRoute,
      'POST /api/v1/auth/refresh': () => json(200, { accessToken: 'access-2' }),
    });

    await api.GET('/api/v1/users/me');

    const me = requestOf(fetch.mock.calls[0]!);
    expect(me.credentials).toBe('include');
    expect(me.headers.get('X-Session-Cookie')).toBe('1');
    const refresh = requestOf(fetch.mock.calls[1]!);
    expect(refresh.credentials).toBe('include');
    expect(refresh.headers.get('X-Session-Cookie')).toBe('1');
    expect(await refresh.json()).toEqual({}); // o token está no cookie httpOnly
  });

  it('quem vem da versão antiga (token no localStorage) troca pelo cookie no primeiro refresh', async () => {
    localStorage.setItem('nb.refreshToken', 'antigo');
    const fetch = mockFetch({
      'POST /api/v1/auth/refresh': () => json(200, { accessToken: 'novo' }),
    });

    await refreshSession();

    expect(await requestOf(fetch.mock.calls[0]!).json()).toEqual({ refreshToken: 'antigo' });
    expect(localStorage.getItem('nb.refreshToken')).toBeNull(); // nunca mais fica exposto ali
    expect(session.hasSession()).toBe(true);
  });
});
