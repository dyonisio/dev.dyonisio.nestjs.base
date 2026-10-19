import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/** Restringe a rota às roles informadas (avaliado pelo RolesGuard global). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
