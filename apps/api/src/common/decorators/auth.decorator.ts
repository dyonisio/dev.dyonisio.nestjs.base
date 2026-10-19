import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '../enums/role.enum';
import { ApiErrors } from './api-error.decorator';
import { Roles } from './roles.decorator';

/**
 * Atalho para rotas autenticadas: documenta o Bearer no Swagger e,
 * se roles forem informadas, restringe o acesso a elas.
 *
 * @example @Auth()                         // qualquer usuário logado
 * @example @Auth(Role.ADMIN, Role.MANAGER) // apenas admin ou manager
 */
export function Auth(...roles: Role[]) {
  const decorators = [
    ApiBearerAuth(),
    ApiErrors([401, 'Missing, invalid or expired token, or the session was ended']),
  ];

  if (roles.length > 0) {
    decorators.push(
      Roles(...roles),
      ApiErrors([403, `Requires one of the roles: ${roles.join(', ')}`]),
    );
  }

  return applyDecorators(...decorators);
}
