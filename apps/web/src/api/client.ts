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

let refreshing: Promise<boolean> | null = null;

/**
 * Troca o refresh token por um par novo. Várias requisições recebendo 401 ao mesmo tempo
 * compartilham UMA renovação (o refresh token é de uso único: dois refreshes em paralelo
 * fariam a API detectar "reuso" e derrubar a sessão).
 */
export function refreshSession(): Promise<boolean> {
  const refreshToken = session.getRefreshToken();
  if (!refreshToken) return Promise.resolve(false);

  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': getLanguage() },
        body: JSON.stringify({ refreshToken }),
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
  const token = session.getAccessToken();
  if (token) request.headers.set('Authorization', `Bearer ${token}`);
  request.headers.set('Accept-Language', getLanguage());
  return request;
}

/** fetch usado pelo cliente: põe o token e, num 401, renova a sessão e repete UMA vez. */
export async function apiFetch(request: Request): Promise<Response> {
  const retry = request.clone();
  const response = await fetch(withHeaders(request));

  const path = new URL(request.url).pathname;
  if (response.status !== 401 || NO_REFRESH.some((p) => path.endsWith(p))) return response;
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
