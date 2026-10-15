import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { IsBoundedString } from '../../../common/validators/text.validators';
import { i18nValidationMessage } from '../../../i18n/i18n-validation';

/** Código de 6 dígitos do app autenticador OU um código de recuperação (ABCD-EFGH). */
const CODE_PATTERN = /^(\d{6}|[A-Za-z2-7]{4}-?[A-Za-z2-7]{4})$/;

export class TwoFactorCodeDto {
  @ApiProperty({
    example: '123456',
    description: '6-digit code from the authenticator app, or a recovery code (ABCD-EFGH)',
  })
  @IsString()
  @Matches(CODE_PATTERN, { message: i18nValidationMessage('validation.twoFactorCode') })
  code: string;
}

export class TwoFactorVerifyDto extends TwoFactorCodeDto {
  @ApiProperty({ description: '`twoFactorToken` returned by the login when 2FA is required' })
  @IsBoundedString(2048)
  twoFactorToken: string;
}

export class TwoFactorSetupResponseDto {
  @ApiProperty({
    example: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    description: 'Base32 secret — for typing manually into the app',
  })
  secret: string;

  @ApiProperty({
    example: 'otpauth://totp/App:jane%40example.com?secret=...&issuer=App',
    description: 'Render it as a QR code for the user to scan',
  })
  otpauthUrl: string;
}

export class RecoveryCodesResponseDto {
  @ApiProperty({
    type: [String],
    example: ['ABCD-EFGH', 'IJKL-MNOP'],
    description: 'Shown ONLY ONCE. Each code works a single time.',
  })
  recoveryCodes: string[];
}

export class TwoFactorChallengeDto {
  @ApiProperty({ example: true, enum: [true] })
  twoFactorRequired: true;

  @ApiProperty({ description: 'Send it to POST /api/v1/auth/2fa/verify with the code' })
  twoFactorToken: string;

  @ApiProperty({ example: 300, description: 'Seconds to complete the second step' })
  expiresIn: number;
}
