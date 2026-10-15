import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiErrors } from '../common/decorators/api-error.decorator';

export const AUTH_RATE_LIMIT_KEY = 'authRateLimit';

/**
 * Aplica os limites rígidos de rotas sensíveis (login, cadastro, senha):
 *  - por IP:     RATE_LIMIT_AUTH_IP_LIMIT tentativas por janela
 *  - por e-mail: RATE_LIMIT_AUTH_EMAIL_LIMIT tentativas por janela (se o body tiver "email")
 */
export const AuthRateLimit = () =>
  applyDecorators(
    SetMetadata(AUTH_RATE_LIMIT_KEY, true),
    ApiErrors([429, 'Too many attempts — see the Retry-After header']),
  );
