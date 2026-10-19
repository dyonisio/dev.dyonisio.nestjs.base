import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18nProvider';

/** Rotas que exigem login: sem sessão, manda para /login (e volta depois). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { m } = useI18n();
  const location = useLocation();

  if (status === 'loading') return <p className="loading">{m.common.loading}</p>;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
