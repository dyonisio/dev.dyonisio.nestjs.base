import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

/**
 * Documenta respostas de erro no Swagger com o formato padrão
 * `{ statusCode, code, message, errors? }`.
 *
 * @example @ApiErrors([401, 'Invalid email or password'], [400, 'Validation failed'])
 */
export function ApiErrors(...responses: [status: number, description: string][]) {
  return applyDecorators(
    ...responses.map(([status, description]) =>
      ApiResponse({ status, description, type: ErrorResponseDto }),
    ),
  );
}
