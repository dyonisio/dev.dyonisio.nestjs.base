import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { deriveSecret } from '../common/crypto/derive-secret';
import { i18nKey } from '../i18n/translations';
import { MailService } from '../mail/mail.service';
import { MailRecipient } from '../mail/mail.types';
import { User } from './entities/user.entity';

interface VerifyEmailPayload {
  sub: string;
  email: string;
  /** verify-email: confirmar o e-mail atual | change-email: confirmar o novo e-mail pedido */
  purpose: 'verify-email' | 'change-email';
  /** change-email: o e-mail da conta quando o pedido foi feito */
  current?: string;
}

/**
 * Confirmação de e-mail por link. O token é um JWT que carrega o e-mail:
 * se o usuário trocar de e-mail, links enviados ao endereço antigo deixam de valer.
 * Usa um segredo derivado do JWT_SECRET só para isso (deriveSecret), então não pode ser
 * confundido com um access token.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async send(user: User): Promise<void> {
    await this.sendLink(user, { sub: user.id, email: user.email, purpose: 'verify-email' });
  }

  /**
   * Troca de e-mail pedida pelo próprio usuário: o novo endereço fica em `pendingEmail` e
   * recebe o link. O e-mail da conta só muda quando o link for usado — assim ninguém troca
   * o e-mail para um endereço que não controla (e um token roubado não basta para sequestrar
   * a conta via "esqueci a senha").
   */
  async requestChange(user: User, newEmail: string): Promise<void> {
    user.pendingEmail = newEmail;
    await this.repo.update(user.id, { pendingEmail: newEmail });
    await this.sendLink(
      { ...user, email: newEmail },
      { sub: user.id, email: newEmail, purpose: 'change-email', current: user.email },
    );
    await this.audit.record(AuditAction.USER_EMAIL_CHANGE_REQUESTED, {
      actorId: user.id,
      target: { type: 'user', id: user.id },
    });
  }

  private async sendLink(user: MailRecipient, payload: VerifyEmailPayload): Promise<void> {
    const expiresIn = this.config.get<number>('jwt.emailVerificationExpiresIn', 86400);
    const token = await this.jwtService.signAsync(payload, { secret: this.secret, expiresIn });
    const verifyUrl = `${this.config.get<string>('app.frontendUrl')}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mailService.sendVerifyEmail(user, verifyUrl, Math.round(expiresIn / 3600));
  }

  /** Reenvia o link; recusa se o e-mail já está confirmado. */
  async resend(user: User): Promise<void> {
    if (user.emailVerifiedAt) {
      throw new BadRequestException(i18nKey('emailVerification.alreadyVerified'));
    }
    await this.send(user);
  }

  /**
   * Confirma o e-mail. Idempotente: clicar no link de novo depois de confirmado
   * apenas retorna o usuário (sem reenviar o e-mail de boas-vindas).
   */
  async verify(token: string): Promise<User> {
    const invalid = new BadRequestException(i18nKey('emailVerification.invalidToken'));

    let payload: VerifyEmailPayload;
    try {
      payload = await this.jwtService.verifyAsync<VerifyEmailPayload>(token, {
        secret: this.secret,
      });
    } catch {
      throw invalid;
    }
    if (payload.purpose === 'change-email') return this.confirmChange(payload, invalid);
    if (payload.purpose !== 'verify-email') throw invalid;

    const user = await this.repo.findOne({ where: { id: payload.sub } });
    if (!user || user.email !== payload.email) throw invalid;
    if (user.emailVerifiedAt) return user;

    user.emailVerifiedAt = new Date();
    const saved = await this.repo.save(user);
    await this.mailService.sendWelcome(saved);
    await this.audit.record(AuditAction.AUTH_EMAIL_VERIFIED, {
      actorId: saved.id,
      metadata: { email: saved.email },
    });
    return saved;
  }

  /** Link de troca de e-mail: só vale para o pedido mais recente e se a conta não mudou. */
  private async confirmChange(payload: VerifyEmailPayload, invalid: Error): Promise<User> {
    const user = await this.repo.findOne({ where: { id: payload.sub } });
    if (!user) throw invalid;
    if (user.email === payload.email) return user; // link usado de novo: nada a fazer
    if (user.pendingEmail !== payload.email || user.email !== payload.current) throw invalid;
    if (await this.repo.exists({ where: { email: payload.email } })) {
      throw new ConflictException(i18nKey('users.emailTaken'));
    }

    const old = { name: user.name, email: user.email, locale: user.locale };
    user.email = payload.email;
    user.pendingEmail = null;
    user.emailVerifiedAt = new Date();
    const saved = await this.repo.save(user);

    await this.mailService.sendEmailChanged(old, saved.email);
    await this.audit.record(AuditAction.USER_EMAIL_CHANGED, {
      actorId: saved.id,
      target: { type: 'user', id: saved.id },
      metadata: { from: old.email, to: saved.email },
    });
    return saved;
  }

  private get secret(): string {
    return deriveSecret(this.config.getOrThrow<string>('jwt.secret'), 'verify-email');
  }
}
