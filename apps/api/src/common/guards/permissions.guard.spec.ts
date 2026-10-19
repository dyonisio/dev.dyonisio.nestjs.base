import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, permissionsOf, ROLE_PERMISSIONS } from '../enums/permission.enum';
import { Role } from '../enums/role.enum';
import { PermissionsGuard } from './permissions.guard';

const contextFor = (user?: { role: string }) =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);
  const requires = (...permissions: Permission[]) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(permissions);

  it('rota sem permissões exigidas: libera', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextFor({ role: Role.USER }))).toBe(true);
  });

  it('libera quando a role do usuário tem a permissão', () => {
    requires(Permission.USERS_READ);
    expect(guard.canActivate(contextFor({ role: Role.MANAGER }))).toBe(true);
  });

  it('exige TODAS as permissões listadas', () => {
    requires(Permission.USERS_READ, Permission.USERS_DELETE);
    expect(() => guard.canActivate(contextFor({ role: Role.MANAGER }))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextFor({ role: Role.ADMIN }))).toBe(true);
  });

  it('sem usuário ou com role desconhecida: bloqueia', () => {
    requires(Permission.USERS_READ);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor({ role: 'hacker' }))).toThrow(ForbiddenException);
  });

  it('admin tem todas as permissões; toda role existe no mapa', () => {
    expect(permissionsOf(Role.ADMIN)).toEqual(Object.values(Permission));
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(Object.values(Role).sort());
  });
});
