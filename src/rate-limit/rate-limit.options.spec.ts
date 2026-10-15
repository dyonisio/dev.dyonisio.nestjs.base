import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AUTH_RATE_LIMIT_KEY } from './auth-rate-limit.decorator';
import {
  buildThrottlerOptions,
  emailFrom,
  isAuthRoute,
  RateLimitConfig,
} from './rate-limit.options';

const config: RateLimitConfig = {
  enabled: true,
  global: { limit: 100, ttl: 60 },
  authIp: { limit: 20, ttl: 900 },
  authEmail: { limit: 5, ttl: 900 },
};

const contextFor = (opts: { authRoute: boolean; body?: object }): ExecutionContext => {
  const handler = () => undefined;
  if (opts.authRoute) Reflect.defineMetadata(AUTH_RATE_LIMIT_KEY, true, handler);
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ body: opts.body }) }),
  } as unknown as ExecutionContext;
};

describe('rate-limit options', () => {
  const storage = {} as ThrottlerStorage;
  // Os tipos do throttler são uniões amplas; nos testes acessamos as opções diretamente
  const options = buildThrottlerOptions(config, storage) as any;
  const throttlers = Object.fromEntries(options.throttlers.map((t: any) => [t.name, t]));

  it('converte as janelas de segundos (config) para milissegundos (throttler)', () => {
    expect(throttlers.global).toMatchObject({ limit: 100, ttl: 60_000 });
    expect(throttlers['auth-ip']).toMatchObject({ limit: 20, ttl: 900_000 });
    expect(throttlers['auth-email']).toMatchObject({ limit: 5, ttl: 900_000 });
    expect(options.storage).toBe(storage);
  });

  it('RATE_LIMIT_ENABLED=false desliga tudo', () => {
    const disabled = buildThrottlerOptions({ ...config, enabled: false }, storage) as any;
    expect(disabled.skipIf()).toBe(true);
    expect(options.skipIf()).toBe(false);
  });

  it('auth-ip só vale em rotas com @AuthRateLimit()', () => {
    expect(throttlers['auth-ip'].skipIf(contextFor({ authRoute: true }))).toBe(false);
    expect(throttlers['auth-ip'].skipIf(contextFor({ authRoute: false }))).toBe(true);
  });

  it('auth-email só vale em rotas com @AuthRateLimit() que recebem e-mail', () => {
    const skip = throttlers['auth-email'].skipIf;
    expect(skip(contextFor({ authRoute: true, body: { email: 'a@b.com' } }))).toBe(false);
    expect(skip(contextFor({ authRoute: true, body: { token: 'x' } }))).toBe(true);
    expect(skip(contextFor({ authRoute: false, body: { email: 'a@b.com' } }))).toBe(true);
  });

  it('auth-email usa o e-mail normalizado como chave', () => {
    expect(throttlers['auth-email'].getTracker({ body: { email: '  Ana@Test.COM ' } })).toBe(
      'email:ana@test.com',
    );
  });

  it('helpers', () => {
    expect(isAuthRoute(contextFor({ authRoute: true }))).toBe(true);
    expect(emailFrom({ body: { email: 42 } })).toBeUndefined();
    expect(emailFrom({})).toBeUndefined();
  });
});
