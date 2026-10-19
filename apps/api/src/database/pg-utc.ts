/**
 * Datas no Postgres SEMPRE em UTC, qualquer que seja o fuso da máquina.
 *
 * As colunas são `timestamp` (sem fuso). Por padrão o driver `pg` grava um Date no horário
 * LOCAL do processo e lê de volta como horário local — enquanto o `DEFAULT now()` do banco
 * grava no fuso da sessão do banco (UTC). Na Lambda o processo já roda em UTC e tudo bate;
 * num Windows/Mac em São Paulo, `createdAt` (do banco) e `lastUsedAt`/`expiresAt` (do código)
 * ficavam 3h desencontrados — e as comparações de expiração também.
 *
 * Importado (por efeito colateral) pela configuração do TypeORM e pelo DataSource da CLI.
 */
// O pacote pg não traz tipos: só o que usamos daqui
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pg = require('pg') as {
  defaults: { parseInputDatesAsUTC: boolean };
  types: { setTypeParser(oid: number, parser: (value: string) => unknown): void };
};

/** OID do tipo `timestamp without time zone` no Postgres. */
export const TIMESTAMP_OID = 1114;

/** Lê "2026-10-19 14:34:14.457" como UTC (e não como horário local). */
export const parseTimestampAsUtc = (value: string): Date => new Date(`${value.replace(' ', 'T')}Z`);

pg.defaults.parseInputDatesAsUTC = true;
pg.types.setTypeParser(TIMESTAMP_OID, parseTimestampAsUtc);
