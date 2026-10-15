import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Role } from '../../common/enums/role.enum';
import { i18nValidationMessage } from '../../i18n/i18n-validation';
import { User } from '../entities/user.entity';

export const USER_SORT_FIELDS = ['createdAt', 'name', 'email'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role, description: 'Filter by role' })
  @IsOptional()
  @IsEnum(Role, { message: i18nValidationMessage() })
  role?: Role;

  @ApiPropertyOptional({
    description: 'Case-insensitive search by name or email',
    example: 'jane',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: i18nValidationMessage() })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ enum: USER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(USER_SORT_FIELDS, { message: i18nValidationMessage() })
  sortBy: UserSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: i18nValidationMessage() })
  order: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'true = list ONLY deleted users (soft delete), e.g. to restore one',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  deleted?: boolean;
}

export class PaginatedUsersDto {
  @ApiProperty({ type: [User] })
  data: User[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
