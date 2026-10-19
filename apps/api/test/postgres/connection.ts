/**
 * Opções de conexão com o Postgres de testes (PGlite iniciado no global-setup).
 * O PGlite atende UMA conexão por vez, por isso o pool fica com no máximo 1 conexão.
 */
export const connectionOptions = (port = Number(process.env.PG_TEST_PORT)) =>
  ({
    type: 'postgres',
    host: '127.0.0.1',
    port,
    username: 'postgres',
    password: 'postgres',
    database: 'postgres',
    extra: { max: 1 },
  }) as const;
