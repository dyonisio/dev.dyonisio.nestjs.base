import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { i18nValidationMessage } from '../../i18n/i18n-validation';
import { AuditAction } from '../audit-action.enum';
import { AuditLog } from '../audit-log.entity';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction, { message: i18nValidationMessage() })
  action?: AuditAction;

  @ApiPropertyOptional({ format: 'uuid', description: 'Who performed the actions' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Affected record (e.g. a user id)' })
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: i18nValidationMessage() })
  targetId?: string;
}

export class PaginatedAuditLogsDto {
  @ApiProperty({ type: [AuditLog] })
  data: AuditLog[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
