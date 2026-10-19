import type { NextFunction, Request, Response } from 'express';
import { RequestContext, RequestContextData } from './request-context';

/** Roda o middleware e devolve o contexto visto "dentro" da requisição. */
function runMiddleware(headers: Record<string, string>, ip = '10.0.0.1') {
  const req = { headers, ip } as unknown as Request & { id?: string };
  const res = { setHeader: jest.fn() } as unknown as Response;
  let seen: RequestContextData | undefined;
  const next: NextFunction = () => {
    seen = RequestContext.get();
  };

  RequestContext.middleware()(req, res, next);
  return { req, res, seen: seen! };
}

describe('RequestContext', () => {
  it('fora de uma requisição não há contexto (e set não quebra)', () => {
    expect(RequestContext.get()).toBeUndefined();
    expect(() => RequestContext.set({ userId: 'x' })).not.toThrow();
  });

  it('gera um requestId quando o cliente não envia, e devolve no header', () => {
    const { req, res, seen } = runMiddleware({ 'user-agent': 'Firefox' });

    expect(seen.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.id).toBe(seen.requestId);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', seen.requestId);
    expect(seen).toMatchObject({ ip: '10.0.0.1', userAgent: 'Firefox' });
  });

  it('reaproveita o X-Request-Id enviado pelo cliente (rastreio ponta a ponta)', () => {
    expect(runMiddleware({ 'x-request-id': 'front-abc_123:1' }).seen.requestId).toBe(
      'front-abc_123:1',
    );
  });

  it.each([
    ['com quebra de linha (injeção em log)', 'abc\n{"level":"fatal"}'],
    ['com espaços', 'a b'],
    ['grande demais', 'x'.repeat(200)],
  ])('ignora X-Request-Id inválido: %s', (_, value) => {
    const { seen } = runMiddleware({ 'x-request-id': value });
    expect(seen.requestId).not.toBe(value);
    expect(seen.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('limita o user agent a 255 caracteres (cabe na coluna do banco)', () => {
    expect(runMiddleware({ 'user-agent': 'x'.repeat(500) }).seen.userAgent).toHaveLength(255);
  });

  it('set complementa o contexto da requisição atual', () => {
    const data: RequestContextData = { requestId: 'r1' };
    RequestContext.run(data, () => RequestContext.set({ userId: 'u1', lang: 'en' }));
    expect(data).toEqual({ requestId: 'r1', userId: 'u1', lang: 'en' });
  });

  it('o contexto sobrevive a operações assíncronas da mesma requisição', async () => {
    const seen = await RequestContext.run({ requestId: 'r2' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return RequestContext.get()?.requestId;
    });
    expect(seen).toBe('r2');
  });
});
