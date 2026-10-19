import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import configuration from '../config/configuration';
import { AUTH_RATE_LIMIT_KEY } from './auth-rate-limit.decorator';

export type RateLimitConfig = ReturnType<typeof configuration>['rateLimit'];

/** A rota está marcada com @AuthRateLimit()? */
export const isAuthRoute = (ctx: ExecutionContext): boolean =>
  Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, ctx.getHandler()) === true;

/** E-mail do body, normalizado — maiúsculas e espaços não burlam o limite por e-mail. */
export const emailFrom = (req: { body?: { email?: unknown } }): string | undefined =>
  typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : undefined;

/**
 * Três limites, todos com contadores compartilhados no banco:
 *  - global:     toda rota, por IP
 *  - auth-ip:    rotas com @AuthRateLimit(), por IP
 *  - auth-email: rotas com @AuthRateLimit() que recebem "email", por e-mail
 *                (protege uma conta atacada a partir de muitos IPs e evita
 *                lotar a caixa de entrada de alguém com "esqueci a senha")
 */
export function buildThrottlerOptions(
  rl: RateLimitConfig,
  storage: ThrottlerStorage,
): ThrottlerModuleOptions {
  return {
    storage,
    skipIf: () => !rl.enabled,
    throttlers: [
      { name: 'global', limit: rl.global.limit, ttl: rl.global.ttl * 1000 },
      {
        name: 'auth-ip',
        limit: rl.authIp.limit,
        ttl: rl.authIp.ttl * 1000,
        skipIf: (ctx) => !isAuthRoute(ctx),
      },
      {
        name: 'auth-email',
        limit: rl.authEmail.limit,
        ttl: rl.authEmail.ttl * 1000,
        skipIf: (ctx) => !isAuthRoute(ctx) || !emailFrom(ctx.switchToHttp().getRequest()),
        getTracker: (req) => `email:${emailFrom(req)}`,
      },
    ],
  };
}
