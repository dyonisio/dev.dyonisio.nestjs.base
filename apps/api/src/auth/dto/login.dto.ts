import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { IsBoundedString } from '../../common/validators/text.validators';
import { i18nValidationMessage } from '../../i18n/i18n-validation';

export class LoginDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  @MaxLength(180, { message: i18nValidationMessage() })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty({ example: 'Password123' })
  @IsBoundedString(256)
  password: string;
}
