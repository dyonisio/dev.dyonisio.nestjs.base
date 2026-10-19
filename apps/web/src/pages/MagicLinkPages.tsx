import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { session } from '../auth/session';
import { useLoginMethods } from '../components/Reauth';
import { AuthCard, BackToLogin, Field, fieldError, FormError } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { useAction } from '../lib/hooks';

/** Lê o e-mail de dentro do token, só para mostrar ("você vai entrar como..."). Não valida nada. */
function emailInToken(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

/**
 * /magic-link?token=... — a tela que o link do e-mail abre.
 *
 * Pede um clique em vez de entrar sozinha: antivírus e filtros de e-mail abrem os links para
 * conferir, e um link de uso único aberto por eles chegaria gasto para a pessoa.
 */
export function MagicLinkPage() {
  const { m, f } = useI18n();
  const { magicLogin } = useAuth();
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token');
  const { run, busy, error } = useAction();

  if (!token) {
    return (
      <AuthCard title={m.magic.title}>
        <p className="alert alert-error" role="alert">
          {m.reset.missingToken}
        </p>
        <BackToLogin />
      </AuthCard>
    );
  }

  const email = emailInToken(token);
  const enter = () =>
    void run(async () => {
      const result = await magicLogin(token);
      if (result.done) navigate('/', { replace: true });
      // Conta com 2FA: o login continua no passo do código
      else navigate('/login', { replace: true, state: { twoFactorToken: result.twoFactorToken } });
    });

  return (
    <AuthCard title={m.magic.title}>
      <p className="muted">{email ? f(m.magic.as, { email }) : m.magic.help}</p>
      <FormError error={error} />
      <button type="submit" className="primary" disabled={busy} onClick={enter}>
        {m.magic.enter}
      </button>
      <BackToLogin />
    </AuthCard>
  );
}

/**
 * /create-password — primeira senha de quem entrou pelo link sem ter uma (conta criada por um
 * admin). Obrigatória para essas contas: o menu leva para cá até a senha existir.
 */
export function CreatePasswordPage() {
  const { m } = useI18n();
  const { user, logout } = useAuth();
  const methods = useLoginMethods();
  const navigate = useNavigate();

  if (methods.data?.hasPassword) return <Navigate to="/" replace />;

  return (
    <AuthCard title={m.createPassword.title}>
      <p className="muted">{m.createPassword.help}</p>
      <CreatePasswordForm onDone={() => navigate('/', { replace: true })} />
      <p className="links">
        <span>{user?.email}</span>
        <button
          type="button"
          className="link"
          onClick={() => void logout().then(() => navigate('/login'))}
        >
          {m.nav.signOut}
        </button>
      </p>
    </AuthCard>
  );
}

/**
 * Formulário da primeira senha (POST /auth/password/set). A API exige login recente e, com 2FA,
 * o código; se o login for antigo, o erro já mostra "entrar de novo".
 */
export function CreatePasswordForm({ onDone }: { onDone: () => void }) {
  const { m } = useI18n();
  const { user } = useAuth();
  const [form, setForm] = useState({ password: '', confirm: '', code: '' });
  const [mismatch, setMismatch] = useState(false);
  const { run, busy, error } = useAction();
  const needsCode = !!user?.twoFactorEnabledAt;

  function submit(e: FormEvent) {
    e.preventDefault();
    setMismatch(form.password !== form.confirm);
    if (form.password !== form.confirm) return;
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/auth/password/set', {
        body: {
          newPassword: form.password,
          ...(needsCode && form.code.trim() ? { code: form.code.trim() } : {}),
        },
      });
      if (apiError || !data) throw apiError;
      session.start(data); // a API encerra as outras sessões e devolve um par novo
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field
        label={m.reset.newPassword}
        type="password"
        autoComplete="new-password"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        hint={m.common.passwordHint}
        required
        error={fieldError(error, 'newPassword')}
      />
      <Field
        label={m.reset.confirm}
        type="password"
        autoComplete="new-password"
        value={form.confirm}
        onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        required
        error={mismatch ? m.reset.mismatch : undefined}
      />
      {needsCode && (
        <Field
          label={m.reauth.code}
          autoComplete="one-time-code"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          hint={m.reauth.codeHint}
          required
          error={fieldError(error, 'code')}
        />
      )}
      <FormError error={error} />
      <div className="panel-actions">
        <button
          type="submit"
          className="primary"
          disabled={busy || !form.password || !form.confirm || (needsCode && !form.code.trim())}
        >
          {m.createPassword.save}
        </button>
      </div>
    </form>
  );
}
