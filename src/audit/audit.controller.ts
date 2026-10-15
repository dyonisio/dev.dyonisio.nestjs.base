import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { Authorize } from '../common/decorators/authorize.decorator';
import { Permission } from '../common/enums/permission.enum';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto, PaginatedAuditLogsDto } from './dto/list-audit-logs-query.dto';

@ApiTags('Audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Authorize(Permission.AUDIT_READ)
  @ApiOperation({
    summary: 'List the audit trail (newest first)',
    description:
      'Who did what, to whom, when and from where (IP, user agent, request id). Permission: `audit:read`.',
  })
  @ApiOkResponse({ type: PaginatedAuditLogsDto })
  @ApiErrors([400, 'Invalid query parameters'])
  findAll(@Query() query: ListAuditLogsQueryDto) {
    return this.auditService.findAll(query);
  }
}
