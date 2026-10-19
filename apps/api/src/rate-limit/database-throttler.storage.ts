import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Storage do @nestjs/throttler no banco de dados.
 *
 * O storage padrão guarda os contadores na memória do processo — na Lambda cada
 * container teria a sua contagem e o limite não funcionaria. Aqui todos os
 * containers compartilham a tabela `rate_limits`.
 *
 * Cada incremento é UM único comando atômico (INSERT ... ON CONFLICT DO UPDATE),
 * então requisições simultâneas nunca "se perdem" na contagem.
 */
@Injectable()
export class DatabaseThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(DatabaseThrottlerStorage.name);

  constructor(private readonly dataSource: DataSource) {}

  async increment(key: string, ttl: number, limit: number): Promise<ThrottlerStorageRecord> {
    const now = Date.now();
    const newExpiry = now + ttl;

    const rows: { hits: number | string; expiresAt: number | string }[] =
      await this.dataSource.query(this.upsertSql(), [key, newExpiry, now]);

    const hits = Number(rows[0].hits);
    const timeToExpire = Math.max(0, Math.ceil((Number(rows[0].expiresAt) - now) / 1000));
    const isBlocked = hits > limit;

    this.cleanupOccasionally(now);
    return {
      totalHits: hits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }

  /** Janela fixa: se a janela expirou, recomeça em 1; senão soma 1. */
  private upsertSql(): string {
    const sql = `
      INSERT INTO "rate_limits" ("key", "hits", "expiresAt") VALUES ($1, 1, $2)
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "rate_limits"."expiresAt" <= $3 THEN 1 ELSE "rate_limits"."hits" + 1 END,
        "expiresAt" = CASE WHEN "rate_limits"."expiresAt" <= $3 THEN $2 ELSE "rate_limits"."expiresAt" END
      RETURNING "hits", "expiresAt"`;
    // SQLite (sql.js, usado nos testes) usa ?1, ?2... em vez de $1, $2...
    return this.dataSource.options.type === 'postgres' ? sql : sql.replace(/\$(\d)/g, '?$1');
  }

  /** Apaga os contadores cujas janelas já acabaram. Retorna quantos saíram. */
  async purgeExpired(now = Date.now()): Promise<number> {
    const placeholder = this.dataSource.options.type === 'postgres' ? '$1' : '?1';
    const result: unknown = await this.dataSource.query(
      `DELETE FROM "rate_limits" WHERE "expiresAt" < ${placeholder}`,
      [now],
    );
    // Postgres devolve [linhas, quantidade]; o SQLite não informa a quantidade
    return Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
  }

  /** Remove contadores expirados em ~1% das chamadas (além do job de manutenção). */
  private cleanupOccasionally(now: number) {
    if (Math.random() >= 0.01) return;
    this.purgeExpired(now).catch((err: Error) =>
      this.logger.warn(`Falha na limpeza de rate_limits: ${err.message}`),
    );
  }
}
