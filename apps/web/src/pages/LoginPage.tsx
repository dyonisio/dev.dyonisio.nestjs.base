import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, toApiError, type ApiError } from '../api/client';
import { useAuth, type LoginResult } from '../auth/AuthProvider';
import { PasskeyBrowserError, passkeyFailureMessage, passkeysSupported } from '../auth/passkey';
import { SocialLogin } from '../components/SocialLogin';
import { AuthCard, ErrorAlert, Field, fieldError, SuccessAlert } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { flash } from '../lib/flash';

/**
 * Login em dois passos quando a conta tem 2FA:
 *  1. e-mail + senha → a API devolve um `twoFactorToken` (5 min) em vez dos tokens
 *  2. código do app (ou de recuperação) → sessão aberta
 */
export function LoginPage() {
  const { m } = useI18n();
  const { login, verifyTwoFactor, passkeyLogin } = useAuth();
  const navigate = useNavigate();
  const state = useLocation().state as {
    from?: string;
    /** vindo do cadastro: entrou com Google/Apple numa conta que tem 2FA */
    twoFactorToken?: string;
  } | null;
  const from = state?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Aviso deixado pela tela anterior (ex.: conta excluída); lido uma vez
  const [notice] = useState(flash.peek);
  useEffect(() => flash.clear(), []);
  // "password": e-mail e senha; "link": só o e-mail, entra pelo link que chega nele
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [linkSent, setLinkSent] = useState<string | null>(null);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(
    state?.twoFactorToken ?? null,
  );
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

  /** Senha ou Google/Apple: entrou, ou falta o código do 2FA. */
  const handleResult = (result: LoginResult) => {
    if (result.done) navigate(from, { replace: true });
    else setTwoFactorToken(result.twoFactorToken);
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => handleResult(await login(email, password)));
  };

  const submitLink = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/auth/magic-link', {
        body: { email },
      });
      if (apiError || !data) throw apiError;
      setLinkSent(data.message); // a mesma mensagem exista o e-mail ou não
    });
  };

  const signInWithPasskey = () =>
    void run(async () => {
      try {
        if (await passkeyLogin()) navigate(from, { replace: true });
      } catch (e) {
        if (!(e instanceof PasskeyBrowserError)) throw e;
        throw {
          statusCode: 0,
          code: 'client',
          message: passkeyFailureMessage(m.passkeys.failures, e),
        } satisfies ApiError;
      }
    });

  const switchMode = (next: 'password' | 'link') => {
    setError(null);
    setLinkSent(null);
    setMode(next);
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
          <button type="submit" disabled={busy || !code.trim()}>
            {m.login.verify}
          </button>
        </form>
      </AuthCard>
    );
  }

  if (mode === 'link') {
    return (
      <AuthCard title={m.login.linkTitle}>
        {linkSent ? (
          <>
            <SuccessAlert>{linkSent}</SuccessAlert>
            <p className="muted step-gap">{m.login.linkSentHelp}</p>
          </>
        ) : (
          <form onSubmit={submitLink} noValidate>
            <p className="muted form-intro">{m.login.linkHelp}</p>
            <Field
              label={m.common.email}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
              error={fieldError(error, 'email')}
            />
            <ErrorAlert error={error?.errors ? null : error} />
            <button type="submit" disabled={busy || !email.trim()}>
              {m.login.sendLink}
            </button>
          </form>
        )}
        <p className="links">
          <button type="button" className="link" onClick={() => switchMode('password')}>
            {m.login.usePassword}
          </button>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={m.login.title}>
      {notice === 'accountDeleted' && <SuccessAlert>{m.login.accountDeleted}</SuccessAlert>}
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
        <button type="submit" disabled={busy || !email.trim() || !password}>
          {m.login.title}
        </button>
      </form>
      <button type="button" className="wide-secondary" onClick={() => switchMode('link')}>
        {m.login.useLink}
      </button>
      {passkeysSupported() && (
        <button
          type="button"
          className="wide-secondary"
          disabled={busy}
          onClick={signInWithPasskey}
        >
          {m.login.usePasskey}
        </button>
      )}
      <SocialLogin onResult={handleResult} />
      <p className="links">
        <Link to="/forgot-password">{m.login.forgot}</Link>
        <span>
          {m.login.noAccount} <Link to="/register">{m.login.register}</Link>
        </span>
      </p>
    </AuthCard>
  );
}
