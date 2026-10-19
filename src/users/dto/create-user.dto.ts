import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { i18nValidationMessage } from '../../i18n/i18n-validation';
import { SUPPORTED_LANGUAGES } from '../../i18n/translations';
import { IsPersonName } from '../../common/validators/text.validators';
import { IsStrongPassword } from '../validators/strong-password.validator';

export class CreateUserDto {
  @ApiProperty({ example: 'Jane Doe', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120, { message: i18nValidationMessage() })
  @IsPersonName()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @ApiProperty({ example: 'jane@example.com', maxLength: 180 })
  @IsEmail()
  @MaxLength(180, { message: i18nValidationMessage() })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty({
    example: 'Password123',
    minLength: 8,
    maxLength: 72,
    description: 'At least 8 characters, with at least one letter and one number',
  })
  @IsStrongPassword()
  password: string;

  @ApiPropertyOptional({ enum: Role, default: Role.USER })
  @IsOptional()
  @IsEnum(Role, { message: i18nValidationMessage() })
  role?: Role;

  @ApiPropertyOptional({
    enum: SUPPORTED_LANGUAGES,
    description: 'Preferred language for emails. Default: the request Accept-Language',
  })
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES, { message: i18nValidationMessage() })
  locale?: string;
}

/**
 * Criação pelo admin. Sem `password` (recomendado), a pessoa recebe um convite para criar a
 * própria senha. Com `password`, recebe só o aviso de que a conta existe.
 */
export class AdminCreateUserDto extends OmitType(CreateUserDto, ['password'] as const) {
  @ApiPropertyOptional({
    example: 'Password123',
    description:
      'Optional. Leave it out (recommended) and the user gets an email to create their own password.',
  })
  @IsOptional()
  @IsStrongPassword()
  password?: string;
}
