import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { UserIdentity } from '../../auth/social/entities/user-identity.entity';
import { FilesService } from '../../files/files.service';
import { SessionService } from '../../sessions/session.service';
import { User } from '../entities/user.entity';

const BATCH = 100;

/**
 * Anonimização (LGPD): contas excluídas há mais de ACCOUNT_PURGE_AFTER_DAYS têm os dados
 * pessoais apagados de vez — vale para exclusão pelo próprio usuário e pelo admin.
 *
 * O registro do usuário continua existindo (com nome/e-mail genéricos) para não quebrar
 * a trilha de auditoria e as estatísticas; o que identifica a pessoa sai: nome, e-mail,
 * senha, 2FA, avatar e arquivos, vínculos com Google/Apple, sessões (IPs e dispositivos)
 * e IP/navegador/detalhes dos registros de auditoria dela.
 */
@Injectable()
export class AccountPurgeService {
  private readonly logger = new Logger(AccountPurgeService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    private readonly files: FilesService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Retorna quantas contas foram anonimizadas nesta execução. */
  async run(now = new Date()): Promise<number> {
    const days = this.config.get<number>('maintenance.accountPurgeAfterDays', 30);
    const due = await this.repo.find({
      where: {
        deletedAt: LessThan(new Date(now.getTime() - days * 86_400_000)),
        anonymizedAt: IsNull(),
      },
      withDeleted: true,
      order: { deletedAt: 'ASC' },
      take: BATCH,
    });

    let done = 0;
    for (const user of due) {
      try {
        await this.anonymize(user.id, now);
        done++;
      } catch (err) {
        this.logger.error({ message: 'Falha ao anonimizar conta', userId: user.id, err });
      }
    }
    return done;
  }

  private async anonymize(userId: string, now: Date): Promise<void> {
    await this.files.removeAllForOwner(userId);
    await this.identities.delete({ userId });
    await this.sessions.deleteAllForUser(userId);
    await this.audit.anonymizeForUser(userId);
    await this.repo.update(userId, {
      name: 'Deleted user',
      // Domínio .invalid é reservado (RFC 2606): nunca recebe e-mail
      email: `deleted-${userId}@deleted.invalid`,
      pendingEmail: null,
      password: null,
      locale: null,
      avatarUrl: null,
      avatarFileId: null,
      isActive: false,
      twoFactorEnabledAt: null,
      twoFactorSecret: null,
      twoFactorLastStep: null,
      twoFactorRecoveryCodes: null,
      anonymizedAt: now,
    });
    await this.audit.record(AuditAction.USER_ANONYMIZED, {
      actorId: null,
      target: { type: 'user', id: userId },
    });
  }
}
