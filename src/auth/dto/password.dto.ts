import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsBoundedString } from '../../common/validators/text.validators';
import { IsStrongPassword } from '../../users/validators/strong-password.validator';
import { LoginDto } from './login.dto';

export class ForgotPasswordDto extends PickType(LoginDto, ['email'] as const) {}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token received in the password reset email link' })
  @IsBoundedString(2048)
  token: string;

  @ApiProperty({
    example: 'NewPassword123',
    description: 'At least 8 characters, with at least one letter and one number',
  })
  @IsStrongPassword()
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Password123' })
  @IsBoundedString(256)
  currentPassword: string;

  @ApiProperty({
    example: 'NewPassword123',
    description: 'At least 8 characters, with at least one letter and one number',
  })
  @IsStrongPassword()
  newPassword: string;
}
