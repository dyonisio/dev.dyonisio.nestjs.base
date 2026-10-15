import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/role.enum';
import { RolesGuard } from './roles.guard';

const contextFor = (user?: { role: Role }) =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('permite quando a rota não exige roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextFor({ role: Role.USER }))).toBe(true);
  });

  it('permite quando o usuário tem uma das roles exigidas', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN, Role.MANAGER]);
    expect(guard.canActivate(contextFor({ role: Role.MANAGER }))).toBe(true);
  });

  it('bloqueia quando o usuário não tem a role exigida', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(contextFor({ role: Role.USER }))).toThrow(ForbiddenException);
  });

  it('bloqueia quando não há usuário na requisição', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
