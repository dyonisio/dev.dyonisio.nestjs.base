import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/request-context/request-context';
import { i18nKey } from '../i18n/translations';
import { SessionResponseDto } from './dto/session-response.dto';
import { SessionService } from './session.service';

/** "Meus dispositivos": onde estou logado, e encerrar sessões. */
@ApiTags('Users / My sessions')
@Controller('users/me/sessions')
@Auth()
// Ver e encerrar sessões é uma ação de segurança — liberada mesmo sem e-mail confirmado
@AllowUnverified()
export class SessionsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List my active sessions (devices)',
    description: 'Most recently used first. `current: true` marks the session making this request.',
  })
  @ApiOkResponse({ type: [SessionResponseDto] })
  async list(@CurrentUser('id') userId: string): Promise<SessionResponseDto[]> {
    const current = RequestContext.get()?.sessionId;
    return (await this.sessions.listActive(userId)).map((s) => SessionResponseDto.from(s, current));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'End one of my sessions',
    description:
      'Signs that device out immediately (its access and refresh tokens stop working). Ending the current session works like a logout.',
  })
  @ApiNoContentResponse()
  @ApiErrors([404, 'Session not found (or not yours, or already ended)'])
  async revoke(@CurrentUser('id') userId: string, @Param('id') sessionId: string): Promise<void> {
    if (!(await this.sessions.revokeOwn(userId, sessionId))) {
      throw new NotFoundException(i18nKey('sessions.notFound'));
    }
    await this.audit.record(AuditAction.SESSION_REVOKED, {
      target: { type: 'session', id: sessionId },
    });
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out of all other devices',
    description: 'Ends every session except the current one.',
  })
  @ApiNoContentResponse()
  async revokeOthers(@CurrentUser('id') userId: string): Promise<void> {
    const ended = await this.sessions.revokeOthers(userId, RequestContext.get()!.sessionId!);
    if (ended > 0) {
      await this.audit.record(AuditAction.SESSION_REVOKED, { metadata: { others: ended } });
    }
  }
}
