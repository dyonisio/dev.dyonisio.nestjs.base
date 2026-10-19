import { startPostgres } from './pglite';

/** Roda uma vez antes de todos os testes: sobe o Postgres (PGlite) compartilhado. */
export default async function globalSetup() {
  const pg = await startPostgres();
  process.env.PG_TEST_PORT = String(pg.port);
  (globalThis as { __PG__?: typeof pg }).__PG__ = pg;
}
