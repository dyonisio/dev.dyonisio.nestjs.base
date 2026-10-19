import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsBoundedString, IsPersonName } from '../../../common/validators/text.validators';
import { i18nValidationMessage } from '../../../i18n/i18n-validation';
import { SUPPORTED_LANGUAGES } from '../../../i18n/translations';

export class SocialLoginDto {
  @ApiProperty({
    description:
      'ID token (JWT) received by the frontend from the provider: Google Identity Services `credential`, or Sign in with Apple `id_token` / `identityToken`',
  })
  @IsBoundedString(8192)
  idToken: string;

  @ApiPropertyOptional({
    description:
      'The nonce the app sent to the provider (recommended). The token must carry it (raw or SHA-256), preventing replay of tokens from other attempts.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: i18nValidationMessage() })
  nonce?: string;

  @ApiPropertyOptional({
    example: 'Jane Doe',
    description:
      'Apple sends the name only to the app, on the first sign-in — forward it here. Ignored for existing accounts.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: i18nValidationMessage() })
  @IsPersonName()
  name?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_LANGUAGES, description: 'Language for new accounts' })
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES, { message: i18nValidationMessage() })
  locale?: string;
}

export class IdentityDto {
  @ApiProperty({ example: 'google' })
  provider: string;

  @ApiProperty({ type: String, nullable: true, example: 'jane@gmail.com' })
  email: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class LoginMethodsDto {
  @ApiProperty({
    description: 'false for accounts created via social login that never set a password',
  })
  hasPassword: boolean;

  @ApiProperty({ type: [IdentityDto] })
  identities: IdentityDto[];
}
