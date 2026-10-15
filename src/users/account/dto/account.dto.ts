import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, Matches, MaxLength } from 'class-validator';
import { IsBoundedString } from '../../../common/validators/text.validators';
import { i18nValidationMessage } from '../../../i18n/i18n-validation';

/**
 * Prova de identidade para ações sensíveis (ReauthService):
 *  - `currentPassword`: obrigatória para quem tem senha
 *  - `code`: obrigatório para quem tem 2FA (código do app ou de recuperação)
 * Contas sem senha (só login social) precisam ter entrado há poucos minutos.
 */
export class ReauthDto {
  @ApiPropertyOptional({
    example: 'Password123',
    description: 'Required if the account has a password',
  })
  @IsOptional()
  @IsBoundedString(256)
  currentPassword?: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'Required if 2FA is enabled: authenticator code or a recovery code',
  })
  @IsOptional()
  @Matches(/^(\d{6}|[A-Za-z2-7]{4}-?[A-Za-z2-7]{4})$/, {
    message: i18nValidationMessage('validation.twoFactorCode'),
  })
  code?: string;
}

export class ChangeEmailDto extends ReauthDto {
  @ApiProperty({ example: 'jane.new@example.com', maxLength: 180 })
  @IsEmail()
  @MaxLength(180, { message: i18nValidationMessage() })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  newEmail: string;
}

export class ChangeEmailResponseDto {
  @ApiProperty({ example: 'We sent a confirmation link to jane.new@example.com.' })
  message: string;

  @ApiProperty({ example: 'jane.new@example.com' })
  pendingEmail: string;
}

/** Formato da exportação (LGPD: direito de acesso/portabilidade). */
export class AccountExportDto {
  @ApiProperty()
  exportedAt: string;

  @ApiProperty({ description: 'Profile (same shape as GET /users/me)' })
  profile: Record<string, unknown>;

  @ApiProperty({
    example: { hasPassword: true, twoFactorEnabled: false, identities: [] },
  })
  security: Record<string, unknown>;

  @ApiProperty({
    isArray: true,
    type: Object,
    description: 'Sign-ins (devices), including ended ones',
  })
  sessions: Record<string, unknown>[];

  @ApiProperty({ isArray: true, type: Object, description: 'Uploaded files (metadata)' })
  files: Record<string, unknown>[];

  @ApiProperty({ isArray: true, type: Object, description: 'Audit events by or about the user' })
  activity: Record<string, unknown>[];
}
