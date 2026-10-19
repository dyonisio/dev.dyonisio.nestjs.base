import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { can, type Permission } from '../auth/permissions';
import { Avatar, SuccessAlert } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';

/** Início (logado): saudação, avisos importantes e atalhos. */
export function HomePage() {
  const { m, f } = useI18n();
  const { user } = useAuth();
  const [resent, setResent] = useState(false);

  if (!user) return null;

  async function resend() {
    const { error } = await api.POST('/api/v1/auth/email/resend');
    if (!error) setResent(true);
  }

  const shortcuts: { to: string; title: string; help: string; permission?: Permission }[] = [
    { to: '/account', title: m.nav.account, help: m.home.accountHelp },
    { to: '/account/security', title: m.nav.security, help: m.home.securityHelp },
    { to: '/account/privacy', title: m.nav.privacy, help: m.home.privacyHelp },
    { to: '/admin/users', title: m.nav.users, help: m.home.usersHelp, permission: 'users:read' },
    { to: '/admin/audit', title: m.nav.audit, help: m.home.auditHelp, permission: 'audit:read' },
  ];

  return (
    <>
      <section className="card">
        <div className="profile">
          <Avatar user={user} size={64} />
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

        {user.twoFactorEnabledAt ? (
          <p className="muted">{m.home.twoFactorOn}</p>
        ) : (
          <p className="alert alert-warning">
            {m.home.twoFactorOff} <Link to="/account/security">{m.home.setUp}</Link>
          </p>
        )}
      </section>

      <section aria-label={m.home.shortcuts} className="tiles">
        {shortcuts
          .filter((s) => !s.permission || can(user, s.permission))
          .map((s) => (
            <Link key={s.to} to={s.to} className="card tile">
              <strong>{s.title}</strong>
              <span className="muted">{s.help}</span>
            </Link>
          ))}
      </section>
    </>
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
