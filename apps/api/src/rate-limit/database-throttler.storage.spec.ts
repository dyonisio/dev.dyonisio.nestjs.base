import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseThrottlerStorage } from './database-throttler.storage';

/**
 * O comportamento real (SQL no Postgres e no SQLite) é testado nos e2e e em `npm run test:pg`.
 * Aqui cobrimos a montagem das queries e os caminhos de limpeza/erro.
 */
describe('DatabaseThrottlerStorage', () => {
  const fakeDataSource = (type: string, row = { hits: '1', expiresAt: '0' }) => {
    const query = jest.fn().mockResolvedValue([row]);
    return { ds: { options: { type }, query } as unknown as DataSource, query };
  };

  afterEach(() => jest.restoreAllMocks());

  it('Postgres usa $1, $2...; SQLite usa ?1, ?2...', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // sem limpeza

    const pg = fakeDataSource('postgres');
    await new DatabaseThrottlerStorage(pg.ds).increment('k', 1000, 5);
    expect(pg.query.mock.calls[0][0]).toContain('VALUES ($1, 1, $2)');

    const sqlite = fakeDataSource('sqljs');
    await new DatabaseThrottlerStorage(sqlite.ds).increment('k', 1000, 5);
    expect(sqlite.query.mock.calls[0][0]).toContain('VALUES (?1, 1, ?2)');
    expect(sqlite.query.mock.calls[0][0]).not.toContain('$');
  });

  it('converte o retorno (bigint vem como string no Postgres) e calcula o bloqueio', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = Date.now();
    const { ds } = fakeDataSource('postgres', { hits: '6', expiresAt: String(now + 30_000) });

    const record = await new DatabaseThrottlerStorage(ds).increment('k', 60_000, 5);

    expect(record.totalHits).toBe(6);
    expect(record.isBlocked).toBe(true);
    expect(record.timeToExpire).toBeGreaterThanOrEqual(29);
    expect(record.timeToBlockExpire).toBe(record.timeToExpire);
  });

  it('dentro do limite: não bloqueia e timeToBlockExpire = 0', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const { ds } = fakeDataSource('postgres', { hits: '2', expiresAt: String(Date.now() + 5000) });

    const record = await new DatabaseThrottlerStorage(ds).increment('k', 60_000, 5);

    expect(record).toMatchObject({ totalHits: 2, isBlocked: false, timeToBlockExpire: 0 });
  });

  it.each([
    ['postgres', '$1'],
    ['sqljs', '?1'],
  ])('em ~1%% das chamadas apaga contadores expirados (%s)', async (type, placeholder) => {
    jest.spyOn(Math, 'random').mockReturnValue(0.001);
    const { ds, query } = fakeDataSource(type);

    await new DatabaseThrottlerStorage(ds).increment('k', 1000, 5);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toBe(
      `DELETE FROM "rate_limits" WHERE "expiresAt" < ${placeholder}`,
    );
  });

  it('falha na limpeza só gera aviso — nunca derruba a requisição', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.001);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { ds, query } = fakeDataSource('postgres');
    query
      .mockResolvedValueOnce([{ hits: '1', expiresAt: '0' }])
      .mockRejectedValueOnce(new Error('lock timeout'));

    await expect(new DatabaseThrottlerStorage(ds).increment('k', 1000, 5)).resolves.toBeDefined();
    await new Promise(process.nextTick);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lock timeout'));
  });

  it('purgeExpired: placeholder do banco e quantidade apagada (o Postgres informa; o SQLite não)', async () => {
    const pg = { options: { type: 'postgres' }, query: jest.fn().mockResolvedValue([[], 3]) };
    await expect(
      new DatabaseThrottlerStorage(pg as unknown as DataSource).purgeExpired(10),
    ).resolves.toBe(3);
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining('$1'), [10]);

    const sqlite = { options: { type: 'sqljs' }, query: jest.fn().mockResolvedValue([]) };
    await expect(
      new DatabaseThrottlerStorage(sqlite as unknown as DataSource).purgeExpired(10),
    ).resolves.toBe(0);
    expect(sqlite.query).toHaveBeenCalledWith(expect.stringContaining('?1'), [10]);
  });
});
