import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { LanguageSwitch, SuccessAlert } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';

/** Início (logado). As telas de conta e de admin entram nas próximas fases. */
export function HomePage() {
  const { m, f } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [resent, setResent] = useState(false);

  if (!user) return null;

  async function resend() {
    const { error } = await api.POST('/api/v1/auth/email/resend');
    if (!error) setResent(true);
  }

  return (
    <main className="page">
      <header className="topbar">
        <strong>{m.appName}</strong>
        <nav>
          <Link to="/account/security">{m.home.security}</Link>
          <button
            type="button"
            className="link"
            onClick={() => void logout().then(() => navigate('/login'))}
          >
            {m.home.signOut}
          </button>
        </nav>
      </header>

      <section className="card">
        <div className="profile">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="avatar" />}
          <div>
            <h1>{f(m.home.hello, { name: user.name })}</h1>
            <p className="muted">{f(m.home.signedInAs, { email: user.email })}</p>
          </div>
        </div>

        {!user.emailVerifiedAt &&
          (resent ? (
            <SuccessAlert>{m.home.resent}</SuccessAlert>
          ) : (
            <p className="alert alert-warning">
              {m.home.unverified}{' '}
              <button type="button" className="link" onClick={() => void resend()}>
                {m.home.resend}
              </button>
            </p>
          ))}
      </section>

      <footer>
        <LanguageSwitch />
      </footer>
    </main>
  );
}

/** /account/security — destino dos botões dos e-mails de alerta (conteúdo na próxima fase). */
export function AccountSecurityPage() {
  const { m } = useI18n();
  return (
    <main className="page">
      <section className="card">
        <h1>{m.security.title}</h1>
        <p className="muted">{m.security.soon}</p>
        <p className="links">
          <Link to="/">{m.security.back}</Link>
        </p>
      </section>
    </main>
  );
}

export function NotFoundPage() {
  const { m } = useI18n();
  return (
    <main className="page">
      <section className="card">
        <h1>{m.notFound.title}</h1>
        <p className="links">
          <Link to="/">{m.notFound.back}</Link>
        </p>
      </section>
    </main>
  );
}
