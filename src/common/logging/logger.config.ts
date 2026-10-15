import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Params } from 'nestjs-pino';
import { RequestContext } from '../request-context/request-context';

/** URL como o Express vê (com o prefixo /api). */
const urlOf = (req: IncomingMessage) =>
  (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';

/**
 * Logs estruturados com pino:
 *  - produção: JSON (uma linha por evento) — filtrável no CloudWatch Logs Insights, ex.:
 *      fields @timestamp, msg, res.statusCode, responseTime | filter requestId = "..."
 *      (ou userId = "...", ou level >= 50 para só erros)
 *  - desenvolvimento: legível, colorido, uma linha por evento (pino-pretty)
 * Cada linha carrega requestId e, se autenticado, userId.
 */
export function buildLoggerOptions(config: ConfigService): Params {
  const env = config.get<string>('app.env', 'development');

  return {
    pinoHttp: {
      level: config.get<string>('app.logLevel', 'info'),
      // Reaproveita o id criado pelo RequestContext (o mesmo do header X-Request-Id)
      genReqId: (req) => req.id ?? 'unknown',
      customProps: () => {
        const ctx = RequestContext.get();
        return { requestId: ctx?.requestId, userId: ctx?.userId };
      },
      // Só o essencial: nada de headers (tokens, cookies) nem corpo (senhas) nos logs
      serializers: {
        req: (req: IncomingMessage) => ({ method: req.method, url: urlOf(req) }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      customSuccessMessage: (req, res) => `${req.method} ${urlOf(req)} ${res.statusCode}`,
      customErrorMessage: (req, res) => `${req.method} ${urlOf(req)} ${res.statusCode}`,
      // Health check é chamado o tempo todo por monitores — não polui os logs
      autoLogging: { ignore: (req) => urlOf(req).startsWith('/api/health') },
      transport:
        env === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
          : undefined,
    },
  };
}
