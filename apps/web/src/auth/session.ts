import type { components } from '../api/schema';

export type User = components['schemas']['User'];

/**
 * Onde os tokens ficam:
 *  - accessToken: só em memória (some ao fechar a aba; dura 15 min de qualquer forma)
 *  - refreshToken: no localStorage, para a sessão sobreviver a um recarregamento
 *
 * O refreshToken no localStorage é o padrão de SPAs, mas fica ao alcance de um script
 * malicioso (XSS) — por isso o site não usa HTML vindo de fora e o CloudFront manda
 * uma CSP restritiva. A API ainda detecta reuso do refresh token e derruba a sessão.
 */
const REFRESH_KEY = 'nb.refreshToken';

type Listener = () => void;

let accessToken: string | null = null;
let currentUser: User | null = null;
const listeners = new Set<Listener>();

const notify = () => listeners.forEach((l) => l());

function readRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null; // navegação privada / armazenamento bloqueado
  }
}

function writeRefresh(token: string | null) {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* sem armazenamento: a sessão dura só enquanto a aba estiver aberta */
  }
}

export const session = {
  getAccessToken: () => accessToken,
  getRefreshToken: readRefresh,
  getUser: () => currentUser,

  /** Guarda o par de tokens (login, cadastro, 2FA, refresh). */
  start(tokens: { accessToken: string; refreshToken: string; user?: User | null }) {
    accessToken = tokens.accessToken;
    writeRefresh(tokens.refreshToken);
    if (tokens.user !== undefined) currentUser = tokens.user;
    notify();
  },

  setUser(user: User | null) {
    currentUser = user;
    notify();
  },

  clear() {
    accessToken = null;
    currentUser = null;
    writeRefresh(null);
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
