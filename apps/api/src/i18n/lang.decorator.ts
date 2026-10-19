import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { I18nRequest } from './i18n.service';

/** Injeta o idioma da requisição (resolvido pelo middleware a partir do Accept-Language). */
export const Lang = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<I18nRequest>().lang ?? 'en',
);
