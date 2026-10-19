import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toApiError, type ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { SocialLogin } from '../components/SocialLogin';
import { AuthCard, ErrorAlert, Field, fieldError } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';

/** Cadastro: a API já abre a sessão e manda o e-mail de confirmação. */
export function RegisterPage() {
  const { m, lang } = useI18n();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ ...form, locale: lang });
      navigate('/', { replace: true });
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={m.register.title}>
      <form onSubmit={submit} noValidate>
        <Field
          label={m.common.name}
          value={form.name}
          onChange={set('name')}
          autoComplete="name"
          required
          error={fieldError(error, 'name')}
        />
        <Field
          label={m.common.email}
          type="email"
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
          required
          error={fieldError(error, 'email')}
        />
        <Field
          label={m.common.password}
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          required
          hint={m.common.passwordHint}
          error={fieldError(error, 'password')}
        />
        <ErrorAlert error={error?.errors ? null : error} />
        <button type="submit" disabled={busy}>
          {m.register.title}
        </button>
      </form>
      {/* Google/Apple: conta nova já nasce confirmada. Se o e-mail já tinha conta com 2FA,
          o login pede o código — a tela de login continua de onde parou. */}
      <SocialLogin
        onResult={(result) =>
          result.done
            ? navigate('/', { replace: true })
            : navigate('/login', { state: { twoFactorToken: result.twoFactorToken } })
        }
      />
      <p className="links">
        <span>
          {m.register.haveAccount} <Link to="/login">{m.register.signIn}</Link>
        </span>
      </p>
    </AuthCard>
  );
}
