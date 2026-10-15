// Mesmo ambiente dos testes e2e, mas apontando para o Postgres (PGlite) e criando
// as tabelas pelas MIGRATIONS (não pelo synchronize) — exatamente como em produção.
import '../setup-env';

Object.assign(process.env, {
  DB_TYPE: 'postgres',
  DB_HOST: '127.0.0.1',
  DB_PORT: process.env.PG_TEST_PORT,
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'postgres',
  DB_SSL: 'false',
  DB_SYNCHRONIZE: 'false',
  DB_MIGRATIONS_RUN: 'true',
  DB_POOL_MAX: '1',
});
