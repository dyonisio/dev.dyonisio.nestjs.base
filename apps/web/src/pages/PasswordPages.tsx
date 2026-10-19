import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, toApiError, type ApiError } from '../api/client';
import {
  AuthCard,
  BackToLogin,
  ErrorAlert,
  Field,
  fieldError,
  SuccessAlert,
} from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';

/** /forgot-password — pede o link por e-mail (a API responde igual, exista o e-mail ou não). */
export function ForgotPasswordPage() {
  const { m } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/api/v1/auth/password/forgot', {
        body: { email },
      });
      if (apiError) throw apiError;
      setSent(true);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={m.forgot.title}>
      {sent ? (
        <SuccessAlert>{m.forgot.sent}</SuccessAlert>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="muted">{m.forgot.help}</p>
          <Field
            label={m.common.email}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            error={fieldError(error, 'email')}
          />
          <ErrorAlert error={error?.errors ? null : error} />
          <button type="submit" disabled={busy || !email.trim()}>
            {m.common.submit}
          </button>
        </form>
      )}
      <BackToLogin />
    </AuthCard>
  );
}

/**
 * /reset-password?token=... — serve para o "esqueci a senha" E para o convite do admin
 * ("criar minha senha"): os dois mandam o mesmo tipo de link, de uso único.
 */
export function ResetPasswordPage() {
  const { m } = useI18n();
  const token = useSearchParams()[0].get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMismatch(password !== confirm);
    if (password !== confirm || !token) return;
    setBusy(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/api/v1/auth/password/reset', {
        body: { token, password },
      });
      if (apiError) throw apiError;
      setDone(true);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={m.reset.title}>
      {!token ? (
        <p className="alert alert-error" role="alert">
          {m.reset.missingToken}
        </p>
      ) : done ? (
        <SuccessAlert>{m.reset.done}</SuccessAlert>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field
            label={m.reset.newPassword}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            hint={m.common.passwordHint}
            error={fieldError(error, 'password')}
          />
          <Field
            label={m.reset.confirm}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            error={mismatch ? m.reset.mismatch : undefined}
          />
          <ErrorAlert error={error?.errors ? null : error} />
          <button type="submit" disabled={busy || !password || !confirm}>
            {m.common.submit}
          </button>
        </form>
      )}
      <BackToLogin />
    </AuthCard>
  );
}
