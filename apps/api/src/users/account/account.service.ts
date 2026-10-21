import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { instanceToPlain } from 'class-transformer';
import { Not, Repository } from 'typeorm';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { Passkey } from '../../auth/passkeys/entities/passkey.entity';
import { Payment } from '../../payments/entities/payment.entity';
import { Subscription } from '../../payments/entities/subscription.entity';
import { UserIdentity } from '../../auth/social/entities/user-identity.entity';
import { Role } from '../../common/enums/role.enum';
import { FilesService } from '../../files/files.service';
import { i18nKey } from '../../i18n/translations';
import { MailService } from '../../mail/mail.service';
import { SessionRevokeReason } from '../../sessions/entities/session.entity';
import { SessionService } from '../../sessions/session.service';
import { EmailVerificationService } from '../email-verification.service';
import { User } from '../entities/user.entity';
import { UsersService } from '../users.service';
import { AccountExportDto, ChangeEmailDto, ReauthDto } from './dto/account.dto';
import { ReauthService } from './reauth.service';

/**
 * Ações do próprio usuário sobre a conta (LGPD): trocar o e-mail, excluir a conta e
 * baixar os seus dados. Todas exigem confirmar a identidade (ReauthService).
 */
@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @InjectRepository(Passkey) private readonly passkeys: Repository<Passkey>,
    private readonly users: UsersService,
    private readonly reauth: ReauthService,
    private readonly emailVerification: EmailVerificationService,
    private readonly sessions: SessionService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Pede a troca: o novo endereço recebe um link e o e-mail só muda quando ele for usado. */
  async changeEmail(userId: string, dto: ChangeEmailDto): Promise<string> {
    const user = await this.reauth.confirm(userId, dto);
    if (dto.newEmail === user.email) throw new BadRequestException(i18nKey('users.sameEmail'));
    if (await this.repo.exists({ where: { email: dto.newEmail } })) {
      throw new ConflictException(i18nKey('users.emailTaken'));
    }
    await this.emailVerification.requestChange(user, dto.newEmail);
    return dto.newEmail;
  }

  /**
   * Exclusão pelo próprio usuário: soft delete na hora (some de tudo, sessões caem e o e-mail
   * fica livre). Os dados pessoais são apagados de vez pelo job de manutenção depois de
   * ACCOUNT_PURGE_AFTER_DAYS — até lá, um admin ainda consegue restaurar a conta.
   */
  async deleteAccount(userId: string, proof: ReauthDto): Promise<void> {
    const user = await this.reauth.confirm(userId, proof);
    if (user.role === Role.ADMIN) {
      const otherAdmins = await this.repo.count({
        where: { role: Role.ADMIN, isActive: true, id: Not(userId) },
      });
      if (otherAdmins === 0) throw new BadRequestException(i18nKey('account.lastAdmin'));
    }

    await this.repo.softDelete(userId);
    await this.sessions.revokeAllForUser(userId, SessionRevokeReason.USER_DELETED);
    await this.audit.record(AuditAction.USER_SELF_DELETED, {
      actorId: userId,
      target: { type: 'user', id: userId },
    });
    const days = this.config.get<number>('maintenance.accountPurgeAfterDays', 30);
    await this.mail.sendAccountDeleted(user, new Date(Date.now() + days * 86_400_000));
  }

  /** Tudo o que a API guarda sobre o usuário, num JSON legível (sem segredos). */
  async exportData(userId: string): Promise<AccountExportDto> {
    const [user, withPassword, identities, passkeys, sessions, files, activity] = await Promise.all(
      [
        this.users.getById(userId),
        this.users.findByIdWithPassword(userId),
        this.identities.find({ where: { userId }, order: { createdAt: 'ASC' } }),
        this.passkeys.find({ where: { userId }, order: { createdAt: 'ASC' } }),
        this.sessions.listAllForUser(userId),
        this.files.listForOwner(userId),
        this.audit.listForUser(userId),
      ],
    );
    // compras e assinaturas (módulo de pagamentos): só o que a pessoa reconhece, sem ids das plataformas
    const [payments, subscriptions] = await Promise.all([
      this.repo.manager.find(Payment, { where: { userId }, order: { createdAt: 'ASC' } }),
      this.repo.manager.find(Subscription, { where: { userId }, order: { createdAt: 'ASC' } }),
    ]);
    await this.audit.record(AuditAction.USER_DATA_EXPORTED, { actorId: userId });

    return {
      exportedAt: new Date().toISOString(),
      profile: instanceToPlain(user),
      security: {
        hasPassword: !!withPassword?.password,
        twoFactorEnabled: !!user.twoFactorEnabledAt,
        identities: identities.map(({ provider, email, createdAt }) => ({
          provider,
          email,
          createdAt,
        })),
        // Sem a chave pública nem o id da credencial: só o que a pessoa reconhece
        passkeys: passkeys.map(({ name, createdAt, lastUsedAt }) => ({
          name,
          createdAt,
          lastUsedAt,
        })),
      },
      sessions: sessions.map((s) => ({
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        revokedReason: s.revokedReason,
      })),
      files: files.map(({ id, purpose, contentType, size, status, createdAt }) => ({
        id,
        purpose,
        contentType,
        size,
        status,
        createdAt,
      })),
      payments: payments.map(
        ({ planId, provider, status, amount, currency, paidAt, createdAt }) => ({
          planId,
          provider,
          status,
          amount,
          currency,
          paidAt,
          createdAt,
        }),
      ),
      subscriptions: subscriptions.map(
        ({ planId, provider, status, currentPeriodEnd, canceledAt, createdAt }) => ({
          planId,
          provider,
          status,
          currentPeriodEnd,
          canceledAt,
          createdAt,
        }),
      ),
      activity: activity.map(({ action, createdAt, ip, userAgent, metadata }) => ({
        action,
        createdAt,
        ip,
        userAgent,
        metadata,
      })),
    };
  }
}
