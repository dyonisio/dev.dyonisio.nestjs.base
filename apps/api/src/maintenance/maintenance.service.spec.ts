import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { FilesCleanupService } from '../files/cleanup/files-cleanup.service';
import type { GrantsService } from '../payments/grants.service';
import { DatabaseThrottlerStorage } from '../rate-limit/database-throttler.storage';
import { SessionService } from '../sessions/session.service';
import { AccountPurgeService } from '../users/account/account-purge.service';
import { MaintenanceService } from './maintenance.service';

/** O caminho completo (com banco) está no e2e (test/account.e2e-spec.ts). */
describe('MaintenanceService', () => {
  const accounts = { run: jest.fn().mockResolvedValue(1) };
  const files = { run: jest.fn().mockResolvedValue({ deleted: 2, failed: 0 }) };
  const sessions = { purge: jest.fn().mockResolvedValue(3) };
  const audit = { purgeOlderThan: jest.fn().mockResolvedValue(4) };
  const rateLimits = { purgeExpired: jest.fn().mockResolvedValue(5) };
  const config: Record<string, unknown> = {};
  const grants = { notifyEnding: jest.fn().mockResolvedValue(6) };
  const service = new MaintenanceService(
    accounts as unknown as AccountPurgeService,
    files as unknown as FilesCleanupService,
    sessions as unknown as SessionService,
    audit as unknown as AuditService,
    rateLimits as unknown as DatabaseThrottlerStorage,
    { get: (k: string, d: unknown) => config[k] ?? d } as unknown as ConfigService,
    grants as unknown as GrantsService,
  );

  beforeEach(() => {
    jest.spyOn(service['logger'], 'error').mockImplementation();
    jest.spyOn(service['logger'], 'log').mockImplementation();
  });

  it('roda todas as tarefas e devolve o relatório', async () => {
    await expect(service.run()).resolves.toEqual({
      anonymizedAccounts: 1,
      deletedUploads: 2,
      deletedSessions: 3,
      deletedAuditLogs: 4,
      deletedRateLimits: 5,
      courtesyEndingNotices: 6,
    });
  });

  it('uma tarefa que falha não impede as outras (o erro vai para o relatório e o log)', async () => {
    sessions.purge.mockRejectedValueOnce(new Error('banco fora'));
    const report = await service.run();
    expect(report.deletedSessions).toEqual({ error: 'banco fora' });
    expect(report.deletedAuditLogs).toBe(4);
    expect(service['logger'].error).toHaveBeenCalled();
  });

  it('AUDIT_RETENTION_DAYS=0 guarda a auditoria para sempre', async () => {
    config['maintenance.auditRetentionDays'] = 0;
    audit.purgeOlderThan.mockClear();
    expect((await service.run()).deletedAuditLogs).toBe(0);
    expect(audit.purgeOlderThan).not.toHaveBeenCalled();
  });
});
