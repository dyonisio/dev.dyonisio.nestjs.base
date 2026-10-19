import createClient from 'openapi-fetch';
import { session } from '../auth/session';
import { API_URL } from '../config';
import { getLanguage } from '../i18n/language';
import type { paths } from './schema';

/** Formato de TODO erro da API (veja docs/ARCHITECTURE.md → Formato dos erros). */
export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  errors?: { field: string; code: string; message: string }[];
  requestId?: string;
}

/** Rotas em que um 401 é resposta "de verdade" (credencial errada), não token expirado. */
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/register', '/auth/2fa/verify'];

/**
 * Códigos de 401 que significam "access token ausente/vencido": só esses valem um refresh.
 * Outros 401 (ex.: `account.reauthRequired`) são respostas finais — repetir não muda nada.
 */
const TOKEN_EXPIRED_CODES = ['errors.http.401', 'auth.sessionExpired'];

async function isExpiredToken(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { code?: string };
    return !body.code || TOKEN_EXPIRED_CODES.includes(body.code);
  } catch {
    return true; // 401 sem corpo JSON: trata como token vencido
  }
}

/** Pede à API o modo cookie: o refresh token vai e volta num cookie httpOnly, nunca no corpo. */
const SESSION_COOKIE_HEADER = 'X-Session-Cookie';

let refreshing: Promise<boolean> | null = null;

/**
 * Troca o refresh token por um par novo. Várias requisições recebendo 401 ao mesmo tempo
 * compartilham UMA renovação (o refresh token é de uso único: dois refreshes em paralelo
 * fariam a API detectar "reuso" e derrubar a sessão).
 */
export function refreshSession(): Promise<boolean> {
  if (!session.hasSession()) return Promise.resolve(false);

  refreshing ??= (async () => {
    try {
      // O refresh token vai sozinho, no cookie httpOnly. Quem vem da versão antiga (token no
      // localStorage) manda o token uma última vez, e a API passa a usar o cookie.
      const legacy = session.takeLegacyRefreshToken();
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': getLanguage(),
          [SESSION_COOKIE_HEADER]: '1',
        },
        body: JSON.stringify(legacy ? { refreshToken: legacy } : {}),
      });
      if (!res.ok) {
        session.clear();
        return false;
      }
      session.start(await res.json());
      return true;
    } catch {
      return false; // sem rede: mantém a sessão para tentar depois
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function withHeaders(request: Request): Request {
  // credentials: 'include' para o navegador mandar (e guardar) o cookie da sessão
  const withCookies = new Request(request, { credentials: 'include' });
  const token = session.getAccessToken();
  if (token) withCookies.headers.set('Authorization', `Bearer ${token}`);
  withCookies.headers.set('Accept-Language', getLanguage());
  withCookies.headers.set(SESSION_COOKIE_HEADER, '1');
  return withCookies;
}

/** fetch usado pelo cliente: põe o token e, num 401, renova a sessão e repete UMA vez. */
export async function apiFetch(request: Request): Promise<Response> {
  const retry = request.clone();
  const response = await fetch(withHeaders(request));

  const path = new URL(request.url).pathname;
  if (response.status !== 401 || NO_REFRESH.some((p) => path.endsWith(p))) return response;
  if (!(await isExpiredToken(response))) return response;
  if (!(await refreshSession())) return response;
  return fetch(withHeaders(retry));
}

/**
 * Cliente tipado da API, gerado do contrato (src/api/schema.d.ts ← apps/api/openapi.json).
 * Rota, corpo e resposta errados viram erro de compilação.
 *
 * @example const { data, error } = await api.GET('/api/v1/users/me');
 */
export const api = createClient<paths>({ baseUrl: API_URL, fetch: apiFetch });

/** Converte qualquer falha (erro da API ou de rede) no formato ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as ApiError;
  }
  return { statusCode: 0, code: 'network', message: '' };
}
