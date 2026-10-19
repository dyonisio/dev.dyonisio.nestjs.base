import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, toApiError, type ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { AuthCard, ErrorAlert, SuccessAlert } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';

/**
 * /verify-email?token=... — link do cadastro e da troca de e-mail.
 * Confirma sozinho ao abrir (uma vez só, mesmo com o React em modo estrito).
 */
export function VerifyEmailPage() {
  const { m } = useI18n();
  const { status, reloadUser } = useAuth();
  const token = useSearchParams()[0].get('token');
  const [state, setState] = useState<'verifying' | 'done' | 'error'>('verifying');
  const [error, setError] = useState<ApiError | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      setState('error');
      return;
    }
    void (async () => {
      try {
        const { error: apiError } = await api.POST('/api/v1/auth/email/verify', {
          body: { token },
        });
        if (apiError) throw apiError;
        setState('done');
      } catch (e) {
        setError(toApiError(e));
        setState('error');
      }
    })();
  }, [token]);

  // Se a pessoa já está logada, atualiza o perfil (emailVerifiedAt / e-mail novo)
  useEffect(() => {
    if (state === 'done' && status === 'authenticated') void reloadUser();
  }, [state, status, reloadUser]);

  return (
    <AuthCard title={m.verify.title}>
      {state === 'verifying' && <p className="muted">{m.verify.verifying}</p>}
      {state === 'done' && (
        <>
          <SuccessAlert>{m.verify.done}</SuccessAlert>
          <p className="links">
            <Link to="/">{m.verify.goHome}</Link>
          </p>
        </>
      )}
      {state === 'error' &&
        (error ? (
          <ErrorAlert error={error} />
        ) : (
          <p className="alert alert-error" role="alert">
            {m.reset.missingToken}
          </p>
        ))}
    </AuthCard>
  );
}
