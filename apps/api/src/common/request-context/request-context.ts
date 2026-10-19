import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Dados da requisição atual, acessíveis de qualquer lugar (services, logger, auditoria)
 * sem precisar repassar parâmetros — via AsyncLocalStorage do Node.
 */
export interface RequestContextData {
  requestId: string;
  ip?: string;
  userAgent?: string;
  /** Preenchido pelo middleware de i18n. */
  lang?: string;
  /** Idioma que o cliente PEDIU (Accept-Language suportado); vazio quando caiu no padrão */
  requestedLang?: string;
  /** Preenchidos pelo JwtStrategy quando a requisição é autenticada. */
  userId?: string;
  sessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/** Aceita o X-Request-Id do cliente só se for um id "comportado" (evita injeção nos logs). */
const VALID_REQUEST_ID = /^[\w.:-]{1,128}$/;

export const RequestContext = {
  /** Contexto da requisição atual (undefined fora de uma requisição: jobs, scripts, testes). */
  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  /** Complementa o contexto atual (ex.: userId depois da autenticação). */
  set(data: Partial<RequestContextData>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, data);
  },

  /** Executa `fn` dentro de um contexto (útil em testes e workers). */
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  /** Primeiro middleware da aplicação: cria o contexto e o X-Request-Id. */
  middleware() {
    return (req: Request & { id?: string }, res: Response, next: NextFunction) => {
      const incoming = req.headers['x-request-id'];
      const requestId =
        typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();

      req.id = requestId;
      res.setHeader('X-Request-Id', requestId);

      const userAgent = req.headers['user-agent'];
      storage.run(
        { requestId, ip: req.ip, userAgent: userAgent ? userAgent.slice(0, 255) : undefined },
        next,
      );
    };
  },
};
