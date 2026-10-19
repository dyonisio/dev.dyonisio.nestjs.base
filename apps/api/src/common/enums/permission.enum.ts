import { Role } from './role.enum';

/**
 * Permissões: O QUE se pode fazer. As roles são só pacotes de permissões (ROLE_PERMISSIONS).
 *
 * Proteja rotas por permissão (`@Authorize(Permission.USERS_READ)`), não por role:
 * para criar uma role nova ou mudar o que uma role pode, basta editar o mapa abaixo —
 * nenhum controller muda.
 *
 * Para uma permissão nova: adicione aqui (formato `recurso:ação`), dê a ela às roles
 * que devem tê-la e use-a na rota.
 */
export enum Permission {
  USERS_READ = 'users:read',
  USERS_CREATE = 'users:create',
  USERS_UPDATE = 'users:update',
  USERS_DELETE = 'users:delete',
  USERS_MANAGE_ROLES = 'users:manage-roles',
  USERS_RESET_2FA = 'users:reset-2fa',
  AUDIT_READ = 'audit:read',
}

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),
  [Role.MANAGER]: [Permission.USERS_READ],
  [Role.USER]: [],
};

/** Permissões de uma role (role desconhecida = nenhuma). */
export function permissionsOf(role: Role | string | undefined): Permission[] {
  return [...(ROLE_PERMISSIONS[role as Role] ?? [])];
}
