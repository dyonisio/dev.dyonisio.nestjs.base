import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { api, refreshSession, type ApiError } from '../api/client';
import { session, type User } from './session';

type Status = 'loading' | 'authenticated' | 'anonymous';

/** Resultado do 1º passo do login: entrou, ou precisa do código do 2FA. */
export type LoginResult = { done: true } | { done: false; twoFactorToken: string };

interface AuthValue {
  status: Status;
  user: User | null;
  login(email: string, password: string): Promise<LoginResult>;
  verifyTwoFactor(twoFactorToken: string, code: string): Promise<void>;
  register(input: { name: string; email: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  reloadUser(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Repassa o erro da API (já traduzido pelo Accept-Language) para a tela mostrar. */
function fail(error: unknown): never {
  throw error as ApiError;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const user = useSyncExternalStore(session.subscribe, session.getUser);
  // Ao abrir o site com um refresh token salvo, recupera a sessão antes de decidir as rotas
  const [restoring, setRestoring] = useState(() => !!session.getRefreshToken());

  useEffect(() => {
    if (!restoring) return;
    let active = true;
    void refreshSession().finally(() => active && setRestoring(false));
    return () => {
      active = false;
    };
  }, [restoring]);

  const reloadUser = useCallback(async () => {
    const { data } = await api.GET('/api/v1/users/me');
    if (data) session.setUser(data);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status: restoring ? 'loading' : user ? 'authenticated' : 'anonymous',
      user,
      async login(email, password) {
        const { data, error } = await api.POST('/api/v1/auth/login', { body: { email, password } });
        if (error || !data) fail(error);
        if ('twoFactorRequired' in data && data.twoFactorRequired) {
          return { done: false, twoFactorToken: data.twoFactorToken };
        }
        session.start(data as Parameters<typeof session.start>[0]);
        return { done: true };
      },
      async verifyTwoFactor(twoFactorToken, code) {
        const { data, error } = await api.POST('/api/v1/auth/2fa/verify', {
          body: { twoFactorToken, code },
        });
        if (error || !data) fail(error);
        session.start(data);
      },
      async register(input) {
        const { data, error } = await api.POST('/api/v1/auth/register', { body: input });
        if (error || !data) fail(error);
        session.start(data);
      },
      async logout() {
        const refreshToken = session.getRefreshToken();
        // Revoga a sessão na API (o access token dela para na hora); falha de rede não impede sair
        if (refreshToken) {
          await api.POST('/api/v1/auth/logout', { body: { refreshToken } }).catch(() => undefined);
        }
        session.clear();
      },
      reloadUser,
    }),
    [restoring, user, reloadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return value;
}
