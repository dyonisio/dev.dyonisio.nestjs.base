import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { FilesCleanupService } from '../files/cleanup/files-cleanup.service';
import { GrantsService } from '../payments/grants.service';
import { DatabaseThrottlerStorage } from '../rate-limit/database-throttler.storage';
import { SessionService } from '../sessions/session.service';
import { AccountPurgeService } from '../users/account/account-purge.service';

export type MaintenanceReport = Record<string, number | { error: string }>;

/**
 * Faxina periódica do banco e do storage. Roda agendada: Lambda `maintenance`
 * (serverless.yml, a cada 6 h) ou `npm run maintenance` (ECS, cron, dev).
 *
 * Cada tarefa roda isolada: se uma falhar, as outras seguem e o erro vai para o log
 * (e para o alarme de erros, na AWS). Para uma tarefa nova, adicione uma linha em `tasks`.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly accounts: AccountPurgeService,
    private readonly files: FilesCleanupService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly rateLimits: DatabaseThrottlerStorage,
    private readonly config: ConfigService,
    private readonly grants: GrantsService,
  ) {}

  async run(now = new Date()): Promise<MaintenanceReport> {
    const days = (key: string, fallback: number) =>
      this.config.get<number>(`maintenance.${key}`, fallback);

    const tasks: Record<string, () => Promise<number>> = {
      // Primeiro: anonimizar apaga arquivos e sessões das contas excluídas
      anonymizedAccounts: () => this.accounts.run(now),
      deletedUploads: async () => (await this.files.run(now)).deleted,
      deletedSessions: () => this.sessions.purge(days('sessionsRetentionDays', 30), now),
      deletedAuditLogs: async () => {
        const retention = days('auditRetentionDays', 365);
        if (retention <= 0) return 0; // 0 = guardar para sempre
        return this.audit.purgeOlderThan(new Date(now.getTime() - retention * 86_400_000));
      },
      deletedRateLimits: () => this.rateLimits.purgeExpired(now.getTime()),
      // e-mail "seu Pro de cortesia termina em breve" (uma vez por cortesia)
      courtesyEndingNotices: () => this.grants.notifyEnding(now),
    };

    const report: MaintenanceReport = {};
    for (const [name, task] of Object.entries(tasks)) {
      try {
        report[name] = await task();
      } catch (err) {
        report[name] = { error: (err as Error).message };
        this.logger.error({ message: `Manutenção: falha na tarefa ${name}`, err });
      }
    }
    this.logger.log({ message: 'Manutenção concluída', ...report });
    return report;
  }
}
