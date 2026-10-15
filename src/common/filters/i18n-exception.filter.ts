import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { I18nRequest, I18nService } from '../../i18n/i18n.service';
import type { ValidationIssue } from '../../i18n/i18n-validation';
import { RequestContext } from '../request-context/request-context';
import { TranslationArgs, TranslationKey } from '../../i18n/translations';

interface ExceptionPayload {
  key?: string;
  message?: unknown;
  args?: TranslationArgs;
  issues?: ValidationIssue[];
}

/**
 * Padroniza e traduz TODAS as respostas de erro:
 *
 *   { "statusCode": 401, "code": "auth.invalidCredentials", "message": "E-mail ou senha inválidos" }
 *
 * - O código lança exceções com uma chave de tradução: `new UnauthorizedException(i18nKey('auth.x'))`
 *   (ou `{ key, args }` quando a mensagem tem placeholders).
 * - Mensagens que não são chaves (ex.: erros internos do Nest/Passport) viram a mensagem
 *   genérica do status: `errors.http.<status>`.
 * - Erros de validação trazem `errors: [{ field, code, message }]`.
 * - Corpos customizados sem `message`/`key` (ex.: health check) passam sem alteração.
 */
@Catch()
export class I18nExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(I18nExceptionFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<I18nRequest>();
    const res = ctx.getResponse<Response>();
    const lang = req.lang ?? this.i18n.resolve(req);

    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : {};
    const payload: ExceptionPayload = typeof raw === 'string' ? { message: raw } : raw;

    if (
      exception instanceof HttpException &&
      payload.key === undefined &&
      !('message' in payload)
    ) {
      return res.status(status).json(payload);
    }

    const candidate = payload.key ?? payload.message;
    const genericKey = `errors.http.${status}`;
    const code: TranslationKey | undefined = this.i18n.has(candidate)
      ? candidate
      : this.i18n.has(genericKey)
        ? genericKey
        : undefined;

    const body: Record<string, unknown> = {
      statusCode: status,
      code: code ?? genericKey,
      message: code
        ? this.i18n.t(code, lang, payload.args)
        : typeof candidate === 'string'
          ? candidate
          : '',
      // Para o usuário informar ao suporte — localiza a requisição exata nos logs
      requestId: RequestContext.get()?.requestId,
    };

    if (Array.isArray(payload.issues)) {
      body.errors = payload.issues.map((issue) => {
        const key: TranslationKey = this.i18n.has(issue.key) ? issue.key : 'validation.invalid';
        return {
          field: issue.field,
          code: key,
          message: this.i18n.t(key, lang, {
            ...issue.args,
            field: this.i18n.field(issue.field, lang),
          }),
        };
      });
    }

    res.status(status).json(body);
  }
}
