import type { User } from './session';

export type Permission = User['permissions'][number];
export type Role = User['role'];

export const ROLES: Role[] = ['admin', 'manager', 'user'];

/**
 * A pessoa logada tem a permissão? (A lista vem pronta da API, calculada a partir da role.)
 * Serve só para ESCONDER o que ela não pode usar — quem protege de verdade é a API.
 */
export function can(user: User | null | undefined, permission: Permission): boolean {
  return !!user?.permissions.includes(permission);
}
