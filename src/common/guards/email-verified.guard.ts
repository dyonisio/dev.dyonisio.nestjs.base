import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { i18nKey } from '../../i18n/translations';
import { User } from '../../users/entities/user.entity';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard global (roda depois do JwtAuthGuard): rotas autenticadas exigem e-mail
 * confirmado, exceto as marcadas com @AllowUnverified(). Seguro por padrão:
 * toda rota nova já nasce protegida. Desligue com REQUIRE_EMAIL_VERIFICATION=false.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get<boolean>('auth.requireEmailVerification', true)) return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, targets)) return true;

    const user = context.switchToHttp().getRequest<{ user?: User }>().user;
    if (user && !user.emailVerifiedAt) {
      throw new ForbiddenException(i18nKey('auth.emailNotVerified'));
    }
    return true;
  }
}
