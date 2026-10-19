import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toApiError, type ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { AuthCard, ErrorAlert, Field, fieldError } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';

/**
 * Login em dois passos quando a conta tem 2FA:
 *  1. e-mail + senha → a API devolve um `twoFactorToken` (5 min) em vez dos tokens
 *  2. código do app (ou de recuperação) → sessão aberta
 */
export function LoginPage() {
  const { m } = useI18n();
  const { login, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await login(email, password);
      if (result.done) navigate(from, { replace: true });
      else setTwoFactorToken(result.twoFactorToken);
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await verifyTwoFactor(twoFactorToken!, code.trim());
      navigate(from, { replace: true });
    });
  };

  if (twoFactorToken) {
    return (
      <AuthCard title={m.login.twoFactorTitle}>
        <p className="muted">{m.login.twoFactorHelp}</p>
        <form onSubmit={submitCode} noValidate>
          <Field
            label={m.login.code}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            required
            error={fieldError(error, 'code')}
          />
          <ErrorAlert error={error?.errors ? null : error} />
          <button type="submit" disabled={busy}>
            {m.login.verify}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={m.login.title}>
      <form onSubmit={submitPassword} noValidate>
        <Field
          label={m.common.email}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          error={fieldError(error, 'email')}
        />
        <Field
          label={m.common.password}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          error={fieldError(error, 'password')}
        />
        <ErrorAlert error={error?.errors ? null : error} />
        <button type="submit" disabled={busy}>
          {m.login.title}
        </button>
      </form>
      <p className="links">
        <Link to="/forgot-password">{m.login.forgot}</Link>
        <span>
          {m.login.noAccount} <Link to="/register">{m.login.register}</Link>
        </span>
      </p>
    </AuthCard>
  );
}
