/**
 * Sobe um Postgres REAL dentro do processo do Node (PGlite = Postgres compilado para WASM)
 * e o expõe numa porta TCP, para o TypeORM conectar com o driver `pg` normal.
 * Dispensa Docker — roda igual na sua máquina e no CI.
 *
 * Usado só pelo global-setup (fora do sandbox de módulos do Jest).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import type { PGlite as PGliteType } from '@electric-sql/pglite';
import type { PGLiteSocketServer as SocketServerType } from '@electric-sql/pglite-socket';
import { AddressInfo, createServer } from 'net';

// Builds CommonJS explícitos: os pacotes são ESM por padrão e o Jest não carrega ESM via require
const { PGlite } = require('@electric-sql/pglite') as { PGlite: typeof PGliteType };
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket/dist/index.cjs') as {
  PGLiteSocketServer: typeof SocketServerType;
};

export interface RunningPostgres {
  port: number;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export async function startPostgres(): Promise<RunningPostgres> {
  const db = await PGlite.create({ extensions: { uuid_ossp } });
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();

  return {
    port,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
