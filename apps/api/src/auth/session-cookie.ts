import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { map, Observable } from 'rxjs';

/**
 * Refresh token em cookie httpOnly, para o front web.
 *
 * O site pede este modo com o cabeçalho `X-Session-Cookie: 1`. Então:
 *  - toda resposta que traz um refresh token o grava num cookie httpOnly (o JavaScript da página
 *    não lê: um script injetado não consegue roubar a sessão) e TIRA o token do corpo;
 *  - refresh e logout leem o cookie, mas só com o cabeçalho junto. Outro site não consegue enviar
 *    um cabeçalho próprio sem passar pelo CORS, e o SameSite=Strict nem manda o cookie a partir
 *    de outro site: não dá para forjar um refresh;
 *  - o cookie só vai para /api/v1/auth (onde é usado), Secure em produção.
 *
 * Sem o cabeçalho (app mobile, integrações), tudo continua como antes: o token no corpo.
 */
export const SESSION_COOKIE_HEADER = 'x-session-cookie';
const PATH = '/api/v1/auth';

export function wantsCookie(req: Request): boolean {
  return req.headers[SESSION_COOKIE_HEADER] === '1';
}

@Injectable()
export class SessionCookie {
  constructor(private readonly config: ConfigService) {}

  /** HTTPS (produção): Secure e o prefixo __Secure- (o navegador recusa o cookie sem HTTPS). */
  private get secure(): boolean {
    return (
      this.config.get<string>('app.env') === 'production' ||
      (this.config.get<string>('app.frontendUrl') ?? '').startsWith('https://')
    );
  }

  get name(): string {
    return this.secure ? '__Secure-refresh' : 'refresh';
  }

  private options(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'strict', path: PATH };
  }

  set(res: Response, token: string): void {
    const maxAge = this.config.get<number>('jwt.refreshExpiresIn', 2592000) * 1000;
    res.cookie(this.name, token, { ...this.options(), maxAge });
  }

  clear(res: Response): void {
    res.clearCookie(this.name, this.options());
  }

  /** O refresh token do cookie (só no modo cookie). */
  read(req: Request): string | undefined {
    if (!wantsCookie(req)) return undefined;
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [key, ...value] = part.trim().split('=');
      if (key === this.name) return decodeURIComponent(value.join('='));
    }
    return undefined;
  }
}

/** Global: no modo cookie, move o refreshToken de qualquer resposta para o cookie. */
@Injectable()
export class SessionCookieInterceptor implements NestInterceptor {
  constructor(private readonly cookie: SessionCookie) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    if (!wantsCookie(req)) return next.handle();

    return next.handle().pipe(
      map((body: unknown) => {
        if (!body || typeof body !== 'object' || !('refreshToken' in body)) return body;
        const { refreshToken, ...rest } = body as { refreshToken?: unknown };
        if (typeof refreshToken !== 'string') return body;
        this.cookie.set(http.getResponse<Response>(), refreshToken);
        return rest;
      }),
    );
  }
}
