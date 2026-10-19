import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsBoundedString } from '../../common/validators/text.validators';
import { IsStrongPassword } from '../../users/validators/strong-password.validator';
import { LoginDto } from './login.dto';

export class RequestMagicLinkDto extends PickType(LoginDto, ['email'] as const) {}

export class VerifyMagicLinkDto {
  @ApiProperty({ description: 'Token from the sign-in link in the email' })
  @IsBoundedString(2048)
  token: string;
}

/** Primeira senha de quem está logado sem ter uma (convite aceito pelo link mágico, ou social). */
export class SetPasswordDto {
  @ApiProperty({
    example: 'NewPassword123',
    description: 'At least 8 characters, with at least one letter and one number',
  })
  @IsStrongPassword()
  newPassword: string;

  @ApiPropertyOptional({
    description: 'Required if 2FA is enabled: authenticator code or a recovery code',
  })
  @IsOptional()
  @IsBoundedString(32)
  code?: string;
}
