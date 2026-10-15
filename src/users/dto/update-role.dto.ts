import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { i18nValidationMessage } from '../../i18n/i18n-validation';

export class UpdateRoleDto {
  @ApiProperty({ enum: Role, example: Role.MANAGER })
  @IsEnum(Role, { message: i18nValidationMessage() })
  role: Role;
}
