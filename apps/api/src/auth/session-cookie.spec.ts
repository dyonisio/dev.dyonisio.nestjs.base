import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SessionCookie } from './session-cookie';

const cookieFor = (env: string, frontendUrl: string) =>
  new SessionCookie({
    get: (key: string) =>
      ({ 'app.env': env, 'app.frontendUrl': frontendUrl, 'jwt.refreshExpiresIn': 60 })[key],
  } as unknown as ConfigService);

const req = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

describe('SessionCookie', () => {
  it('em produção (HTTPS): Secure e prefixo __Secure- (o navegador recusa sem HTTPS)', () => {
    const res = { cookie: jest.fn() };
    const cookie = cookieFor('production', 'https://base.dyonisio.dev');

    cookie.set(res as never, 'abc');

    expect(cookie.name).toBe('__Secure-refresh');
    expect(res.cookie).toHaveBeenCalledWith('__Secure-refresh', 'abc', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 60_000,
    });
  });

  it('em desenvolvimento (http://localhost): sem Secure, nome simples', () => {
    expect(cookieFor('development', 'http://localhost:5173').name).toBe('refresh');
  });

  it('lê o cookie só com o cabeçalho X-Session-Cookie', () => {
    const cookie = cookieFor('development', 'http://localhost:5173');
    const headers = { cookie: 'outro=1; refresh=tok%2Ben' };

    expect(cookie.read(req({ ...headers, 'x-session-cookie': '1' }))).toBe('tok+en');
    expect(cookie.read(req(headers))).toBeUndefined();
  });
});
