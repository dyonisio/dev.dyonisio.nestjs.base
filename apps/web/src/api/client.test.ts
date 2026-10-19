import { afterEach, describe, expect, it, vi } from 'vitest';
import { session } from '../auth/session';
import { json, mockFetch, requestOf } from '../test/fetch-mock';
import { api } from './client';

const tokens = (n: number) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}` });
const unauthorized = () => json(401, { statusCode: 401, code: 'auth.unauthorized', message: '' });

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
    expect(session.getRefreshToken()).toBe('refresh-2');
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
      'POST /api/v1/auth/refresh': unauthorized,
    });

    const { error } = await api.GET('/api/v1/users/me');

    expect(error).toMatchObject({ statusCode: 401 });
    expect(session.getRefreshToken()).toBeNull();
    expect(session.getAccessToken()).toBeNull();
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
});
