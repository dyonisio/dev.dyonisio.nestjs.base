import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { i18nKey } from '../../i18n/translations';
import { Role } from '../enums/role.enum';

/** Guard global: valida as roles definidas com @Roles() / @Auth(...roles). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: { role: Role } }>().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException(i18nKey('auth.forbidden'));
    }
    return true;
  }
}
