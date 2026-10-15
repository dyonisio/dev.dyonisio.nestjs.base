import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Permission } from '../enums/permission.enum';
import { ApiErrors } from './api-error.decorator';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Rota autenticada que exige TODAS as permissões informadas (avaliado pelo PermissionsGuard).
 * Documenta o Bearer e os erros 401/403 no Swagger.
 *
 * @example @Authorize(Permission.USERS_READ)
 */
export function Authorize(...permissions: Permission[]) {
  return applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    ApiBearerAuth(),
    ApiErrors(
      [401, 'Missing, invalid or expired token, or the session was ended'],
      [403, `Requires the permission(s): ${permissions.join(', ')}`],
    ),
  );
}
