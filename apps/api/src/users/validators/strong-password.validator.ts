import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MaxBytes } from '../../common/validators/text.validators';
import { i18nValidationMessage } from '../../i18n/i18n-validation';

/**
 * Senha com 8-72 caracteres e no máximo 72 bytes (o bcrypt ignora o que passa disso:
 * 72 letras acentuadas ocupam mais de 72 bytes), com ao menos uma letra e um número.
 */
export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: i18nValidationMessage() }),
    MaxLength(72, { message: i18nValidationMessage() }),
    MaxBytes(72),
    Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
      message: i18nValidationMessage('validation.strongPassword'),
    }),
  );
}
