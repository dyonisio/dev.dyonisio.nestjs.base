import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { DatabaseThrottlerStorage } from '../../src/rate-limit/database-throttler.storage';
import { connectionOptions } from './connection';

/**
 * Garante que as MIGRATIONS (o que roda em produção) criam exatamente o schema
 * que as ENTIDADES (o que o código espera) descrevem — num Postgres de verdade.
 */
describe('Migrations (Postgres)', () => {
  let ds: DataSource;
  const migrationFiles = readdirSync(join(__dirname, '../../src/database/migrations')).filter((f) =>
    f.endsWith('.ts'),
  );

  beforeAll(async () => {
    ds = await new DataSource({
      ...connectionOptions(),
      entities: [join(__dirname, '../../src/**/*.entity.ts')],
      migrations: [join(__dirname, '../../src/database/migrations/*.ts')],
    }).initialize();
  });

  afterAll(() => ds.destroy());

  const tables = async (): Promise<string[]> =>
    (
      await ds.query<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      )
    ).map((r) => r.tablename);

  const undoAll = async () => {
    while ((await ds.query<unknown[]>(`SELECT 1 FROM "migrations"`)).length > 0) {
      await ds.undoLastMigration();
    }
  };

  it('aplica todas as migrations em um banco vazio', async () => {
    const applied = await ds.runMigrations();

    expect(applied).toHaveLength(migrationFiles.length);
    expect(await tables()).toEqual([
      'audit_logs',
      'files',
      'migrations',
      'passkeys',
      'payments',
      'plans',
      'rate_limits',
      'refresh_tokens',
      'sessions',
      'subscriptions',
      'user_identities',
      'users',
    ]);
  });

  it('o schema criado pelas migrations é IDÊNTICO ao descrito pelas entidades', async () => {
    // É o que o `migration:generate` faria: se houver diferença, falta uma migration
    // (ou a entidade foi alterada sem gerar a migration correspondente).
    const { upQueries } = await ds.driver.createSchemaBuilder().log();

    expect(upQueries.map((q) => q.query)).toEqual([]);
  });

  it('todas as migrations podem ser desfeitas (down) e reaplicadas', async () => {
    await undoAll();
    expect(await tables()).toEqual(['migrations']);

    expect(await ds.runMigrations()).toHaveLength(migrationFiles.length);
    expect((await ds.driver.createSchemaBuilder().log()).upQueries).toEqual([]);
  });

  /** Desfaz migrations (da mais nova para a mais antiga) até reverter a informada. */
  const undoUntil = async (name: string) => {
    const executed = async () =>
      (await ds.query<{ name: string }[]>(`SELECT "name" FROM "migrations"`)).map((m) => m.name);
    while ((await executed()).includes(name)) await ds.undoLastMigration();
  };

  it('AddEmailVerification marca usuários já existentes como verificados', async () => {
    // volta para antes da coluna emailVerifiedAt existir (desfazendo as posteriores também)
    await undoUntil('AddEmailVerification1760800000000');
    await ds.query(
      `INSERT INTO "users" ("name", "email", "password", "createdAt")
       VALUES ('Antigo', 'antigo@test.com', 'hash', '2025-01-01T10:00:00Z')`,
    );

    await ds.runMigrations();

    const [user] = await ds.query<{ createdAt: Date; emailVerifiedAt: Date }[]>(
      `SELECT "createdAt", "emailVerifiedAt" FROM "users" WHERE "email" = 'antigo@test.com'`,
    );
    expect(user.emailVerifiedAt).toEqual(user.createdAt);
  });

  it('soft delete: o e-mail fica livre para um novo cadastro, mas é único entre os ativos', async () => {
    const insert = (email: string, deletedAt: string | null) =>
      ds.query(
        `INSERT INTO "users" ("name", "email", "password", "deletedAt") VALUES ('X', $1, 'h', $2)`,
        [email, deletedAt],
      );

    await insert('reuso@test.com', '2025-01-01T00:00:00Z'); // conta excluída
    await insert('reuso@test.com', null); // novo cadastro com o mesmo e-mail: permitido
    await expect(insert('reuso@test.com', null)).rejects.toThrow(/UQ_users_email_active/);
  });

  describe('SQL do rate limiting no Postgres', () => {
    let storage: DatabaseThrottlerStorage;

    beforeAll(() => {
      storage = new DatabaseThrottlerStorage(ds);
    });

    it('conta as requisições e bloqueia acima do limite', async () => {
      const hits: number[] = [];
      for (let i = 0; i < 4; i++) {
        hits.push((await storage.increment('pg:sequencial', 60_000, 3)).totalHits);
      }
      const last = await storage.increment('pg:sequencial', 60_000, 3);

      expect(hits).toEqual([1, 2, 3, 4]);
      expect(last).toMatchObject({ totalHits: 5, isBlocked: true });
      expect(last.timeToExpire).toBeGreaterThan(0);
    });

    it('requisições simultâneas não se perdem na contagem (incremento atômico)', async () => {
      await Promise.all(
        Array.from({ length: 25 }, () => storage.increment('pg:concorrente', 60_000, 100)),
      );
      const { totalHits } = await storage.increment('pg:concorrente', 60_000, 100);

      expect(totalHits).toBe(26);
    });

    it('reinicia a contagem quando a janela expira', async () => {
      await storage.increment('pg:janela', 1, 3); // janela de 1 ms
      await new Promise((r) => setTimeout(r, 10));

      expect((await storage.increment('pg:janela', 60_000, 3)).totalHits).toBe(1);
    });
  });
});
