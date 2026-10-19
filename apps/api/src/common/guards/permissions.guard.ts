import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { i18nKey } from '../../i18n/translations';
import { PERMISSIONS_KEY } from '../decorators/authorize.decorator';
import { Permission, permissionsOf } from '../enums/permission.enum';
import { Role } from '../enums/role.enum';

/**
 * Guard global: valida as permissões definidas com @Authorize(...).
 * As permissões vêm da role ATUAL do usuário (carregada do banco a cada requisição),
 * então trocar a role de alguém vale na hora, mesmo com tokens já emitidos.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: { role: Role } }>().user;
    const granted = permissionsOf(user?.role);
    if (!user || !required.every((p) => granted.includes(p))) {
      throw new ForbiddenException(i18nKey('auth.forbidden'));
    }
    return true;
  }
}
