import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { Authorize } from '../common/decorators/authorize.decorator';
import { Permission } from '../common/enums/permission.enum';
import { UuidParam } from '../common/pipes/uuid-param.pipe';
import { i18nKey } from '../i18n/translations';
import { User } from '../users/entities/user.entity';
import { SessionResponseDto } from './dto/session-response.dto';
import { SessionRevokeReason } from './entities/session.entity';
import { SessionService } from './session.service';

/**
 * Sessões de um usuário, vistas pelo admin: para o "acho que invadiram minha conta".
 * Ver pede `users:read`; encerrar pede `users:update`. Toda ação fica na auditoria.
 *
 * Fica no SessionsModule, registrado DEPOIS do SessionsController: assim /users/me/sessions
 * (as próprias sessões) é casado antes de /users/:id/sessions e o "me" nunca vira um :id.
 */
@ApiTags('Users')
@Controller('users/:id/sessions')
export class AdminSessionsController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** 404 para usuário inexistente (ou excluído), como o resto de /users/:id. */
  private async ensureUser(id: string): Promise<void> {
    if (!(await this.users.exists({ where: { id } }))) {
      throw new NotFoundException(i18nKey('users.notFound'));
    }
  }

  @Get()
  @Authorize(Permission.USERS_READ)
  @ApiOperation({
    summary: "List a user's active sessions (devices)",
    description: 'Most recently used first. Permission: `users:read`.',
  })
  @ApiOkResponse({ type: [SessionResponseDto] })
  @ApiErrors([400, 'Invalid id'], [404, 'User not found'])
  async list(@Param('id', UuidParam) id: string): Promise<SessionResponseDto[]> {
    await this.ensureUser(id);
    return (await this.sessions.listActive(id)).map((s) => SessionResponseDto.from(s));
  }

  @Delete()
  @Authorize(Permission.USERS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign a user out of every device',
    description:
      'Ends all sessions of the user at once (access and refresh tokens stop working). The password stays the same: to lock an attacker out for good, the person should also change it. Permission: `users:update`.',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Invalid id'], [404, 'User not found'])
  async revokeAll(@Param('id', UuidParam) id: string): Promise<void> {
    await this.ensureUser(id);
    const ended = await this.sessions.revokeAllForUser(id, SessionRevokeReason.REVOKED_BY_ADMIN);
    await this.audit.record(AuditAction.SESSION_REVOKED, {
      target: { type: 'user', id },
      metadata: { byAdmin: true, sessions: ended },
    });
  }

  @Delete(':sessionId')
  @Authorize(Permission.USERS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'End one session of a user',
    description: 'Signs that device out immediately. Permission: `users:update`.',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Invalid id'], [404, 'User or session not found'])
  async revokeOne(
    @Param('id', UuidParam) id: string,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.ensureUser(id);
    if (!(await this.sessions.revokeOwn(id, sessionId, SessionRevokeReason.REVOKED_BY_ADMIN))) {
      throw new NotFoundException(i18nKey('sessions.notFound'));
    }
    await this.audit.record(AuditAction.SESSION_REVOKED, {
      target: { type: 'user', id },
      metadata: { byAdmin: true, session: sessionId },
    });
  }
}
