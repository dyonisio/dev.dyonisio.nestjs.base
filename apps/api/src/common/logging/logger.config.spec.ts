import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'http';
import { RequestContext } from '../request-context/request-context';
import { buildLoggerOptions } from './logger.config';

const optionsFor = (config: Record<string, unknown>) =>
  buildLoggerOptions({
    get: (key: string, def?: unknown) => config[key] ?? def,
  } as unknown as ConfigService).pinoHttp as any;

const req = (url: string, extra: object = {}) =>
  ({ method: 'GET', url, ...extra }) as unknown as IncomingMessage;
const res = (statusCode: number) => ({ statusCode }) as ServerResponse;

describe('buildLoggerOptions', () => {
  const opts = optionsFor({ 'app.env': 'production', 'app.logLevel': 'warn' });

  it('nível vem do LOG_LEVEL; JSON puro em produção, pino-pretty só em desenvolvimento', () => {
    expect(opts.level).toBe('warn');
    expect(opts.transport).toBeUndefined();
    expect(optionsFor({ 'app.env': 'development' }).transport.target).toBe('pino-pretty');
  });

  it('nível do log de acordo com o status da resposta', () => {
    expect(opts.customLogLevel(req('/'), res(200))).toBe('info');
    expect(opts.customLogLevel(req('/'), res(404))).toBe('warn');
    expect(opts.customLogLevel(req('/'), res(503))).toBe('error');
    expect(opts.customLogLevel(req('/'), res(200), new Error('x'))).toBe('error');
  });

  it('não loga headers nem corpo: só método, URL (com prefixo) e status', () => {
    const logged = opts.serializers.req(
      req('/users', { originalUrl: '/api/v1/users', headers: { authorization: 'Bearer x' } }),
    );
    expect(logged).toEqual({ method: 'GET', url: '/api/v1/users' });
    expect(opts.serializers.res(res(201))).toEqual({ statusCode: 201 });
    expect(opts.customSuccessMessage(req('/api/v1/x'), res(200))).toBe('GET /api/v1/x 200');
    expect(opts.customErrorMessage(req('/api/v1/x'), res(500))).toBe('GET /api/v1/x 500');
  });

  it('não loga o health check (chamado o tempo todo por monitores)', () => {
    expect(opts.autoLogging.ignore(req('/api/health'))).toBe(true);
    expect(opts.autoLogging.ignore(req('/api/v1/users'))).toBe(false);
    expect(opts.autoLogging.ignore(req(undefined as unknown as string))).toBe(false);
  });

  it('cada linha leva requestId e userId do contexto da requisição', () => {
    expect(opts.genReqId({ id: 'abc' })).toBe('abc');
    expect(opts.genReqId({})).toBe('unknown');
    expect(opts.customProps()).toEqual({ requestId: undefined, userId: undefined });

    RequestContext.run({ requestId: 'r1', userId: 'u1' }, () => {
      expect(opts.customProps()).toEqual({ requestId: 'r1', userId: 'u1' });
    });
  });
});
