import { parseTimestampAsUtc } from './pg-utc';

describe('pg-utc', () => {
  it('lê timestamp sem fuso como UTC, independente do fuso da máquina', () => {
    expect(parseTimestampAsUtc('2026-10-19 14:34:14.457').toISOString()).toBe(
      '2026-10-19T14:34:14.457Z',
    );
    expect(parseTimestampAsUtc('2026-01-01 00:00:00').toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('configura o driver para gravar e ler em UTC', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg') as {
      defaults: { parseInputDatesAsUTC: boolean };
      types: { getTypeParser(oid: number): (v: string) => unknown };
    };
    expect(pg.defaults.parseInputDatesAsUTC).toBe(true);
    expect((pg.types.getTypeParser(1114)('2026-10-19 14:34:14') as Date).toISOString()).toBe(
      '2026-10-19T14:34:14.000Z',
    );
  });
});
