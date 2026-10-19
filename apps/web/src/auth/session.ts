import type { components } from '../api/schema';

export type User = components['schemas']['User'];

/**
 * Onde a sessão fica:
 *  - accessToken: só em memória (some ao fechar a aba; dura 15 min de qualquer forma)
 *  - refreshToken: num cookie httpOnly que a API grava (o JavaScript da página não lê).
 *    Um script injetado (XSS) não consegue roubar a sessão para usar em outro lugar.
 *  - no localStorage fica só um MARCADOR "tem sessão" (sem nada secreto), para o site saber,
 *    ao abrir, se vale tentar renovar a sessão pelo cookie.
 * Veja apps/api/src/auth/session-cookie.ts.
 */
const SESSION_KEY = 'nb.session';
/** Versão antiga guardava o refresh token aqui: é trocado pelo cookie no primeiro refresh */
const LEGACY_REFRESH_KEY = 'nb.refreshToken';

type Listener = () => void;

let accessToken: string | null = null;
let currentUser: User | null = null;
const listeners = new Set<Listener>();

const notify = () => listeners.forEach((l) => l());

function storage(action: (s: Storage) => void) {
  try {
    action(localStorage);
  } catch {
    /* navegação privada / armazenamento bloqueado: a sessão dura enquanto a aba estiver aberta */
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const session = {
  getAccessToken: () => accessToken,
  getUser: () => currentUser,

  /** Há (ou havia) uma sessão para tentar renovar pelo cookie? */
  hasSession: () => read(SESSION_KEY) === '1' || !!read(LEGACY_REFRESH_KEY),

  /** Refresh token da versão antiga, se houver (lido uma vez e apagado). */
  takeLegacyRefreshToken(): string | null {
    const token = read(LEGACY_REFRESH_KEY);
    storage((s) => s.removeItem(LEGACY_REFRESH_KEY));
    return token;
  },

  /** Abre a sessão (login, cadastro, 2FA, refresh). O refresh token já veio no cookie. */
  start(tokens: { accessToken: string; user?: User | null }) {
    accessToken = tokens.accessToken;
    storage((s) => s.setItem(SESSION_KEY, '1'));
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
    storage((s) => {
      s.removeItem(SESSION_KEY);
      s.removeItem(LEGACY_REFRESH_KEY);
    });
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
