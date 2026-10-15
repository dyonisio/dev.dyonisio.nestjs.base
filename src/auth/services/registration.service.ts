import { Injectable } from '@nestjs/common';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { Role } from '../../common/enums/role.enum';
import { EmailVerificationService } from '../../users/email-verification.service';
import { UsersService } from '../../users/users.service';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { RegisterDto } from '../dto/register.dto';
import { SessionService } from '../../sessions/session.service';

/** Auto-cadastro público: cria o usuário não verificado e envia o link de confirmação. */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly emailVerification: EmailVerificationService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create(
      { ...dto, role: Role.USER },
      { emailVerified: false, audit: false },
    );
    await this.audit.record(AuditAction.USER_REGISTERED, {
      actorId: user.id,
      target: { type: 'user', id: user.id },
    });
    // O e-mail de boas-vindas sai só depois da confirmação (EmailVerificationService.verify)
    await this.emailVerification.send(user);
    return { ...(await this.sessionService.create(user)), user };
  }
}
