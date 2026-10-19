import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { i18nKey } from '../i18n/translations';
import { MailService } from '../mail/mail.service';
import { AdminCreateUserDto } from './dto/create-user.dto';
import { User } from './entities/user.entity';
import { passwordLinkSecret } from './password-link';
import { UsersService } from './users.service';

/**
 * Contas criadas por um admin. O jeito recomendado é o admin NÃO definir a senha:
 * a pessoa recebe um convite com um link para criar a própria senha (uso único,
 * INVITE_EXPIRES_IN, padrão 7 dias) — a senha nunca passa por outra pessoa.
 * Se o admin informar uma senha, o e-mail só avisa que a conta existe (sem a senha).
 */
@Injectable()
export class UserInvitationService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async createByAdmin(dto: AdminCreateUserDto): Promise<User> {
    // O admin responde pelo e-mail: a conta já nasce confirmada
    const user = await this.users.create(dto, { emailVerified: true });
    await this.notify(user, !dto.password);
    return user;
  }

  /** Reenvia o convite (ex.: o link expirou). Só para quem ainda não criou a senha. */
  async resend(userId: string): Promise<void> {
    const user = await this.users.findByIdWithPassword(userId);
    if (!user) throw new NotFoundException(i18nKey('users.notFound'));
    if (user.password) throw new BadRequestException(i18nKey('users.alreadyHasPassword'));
    await this.notify(user, true);
  }

  private async notify(user: User, withSetPasswordLink: boolean): Promise<void> {
    if (!withSetPasswordLink) {
      await this.mail.sendAccountCreated(user, null);
      return;
    }

    const expiresIn = this.config.get<number>('jwt.inviteExpiresIn', 604800);
    // Mesmo token do "esqueci a senha": a tela /reset-password do front serve para os dois
    const token = await this.jwt.signAsync(
      { sub: user.id, purpose: 'reset-password' },
      {
        secret: passwordLinkSecret(this.config.getOrThrow<string>('jwt.secret'), {
          id: user.id,
          password: null,
        }),
        expiresIn,
      },
    );
    const url = `${this.config.get<string>('app.frontendUrl')}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.sendAccountCreated(user, { url, expiresInDays: Math.round(expiresIn / 86400) });
    await this.audit.record(AuditAction.USER_INVITATION_SENT, {
      target: { type: 'user', id: user.id },
    });
  }
}
