import type { RunningPostgres } from './pglite';

export default async function globalTeardown() {
  await (globalThis as { __PG__?: RunningPostgres }).__PG__?.stop();
}
