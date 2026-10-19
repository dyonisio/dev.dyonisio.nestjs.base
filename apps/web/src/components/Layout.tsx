import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { can, type Permission } from '../auth/permissions';
import { useI18n } from '../i18n/I18nProvider';
import { Avatar, LanguageSwitch } from './ui';

/** Moldura das telas logadas: menu no topo (os itens de admin só aparecem com permissão). */
export function AppLayout() {
  const { m } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const links: { to: string; label: string; permission?: Permission }[] = [
    { to: '/', label: m.nav.home },
    { to: '/account', label: m.nav.account },
    { to: '/account/security', label: m.nav.security },
    { to: '/account/privacy', label: m.nav.privacy },
    { to: '/admin/users', label: m.nav.users, permission: 'users:read' },
    { to: '/admin/audit', label: m.nav.audit, permission: 'audit:read' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          {m.appName}
        </Link>
        <button
          type="button"
          className="secondary menu-toggle"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen(!open)}
        >
          {m.nav.menu}
        </button>
        <nav id="main-nav" className={open ? 'open' : undefined} onClick={() => setOpen(false)}>
          {links
            .filter((l) => !l.permission || can(user, l.permission))
            .map((l) => (
              <NavLink key={l.to} to={l.to} end>
                {l.label}
              </NavLink>
            ))}
          <span className="nav-user">
            <Avatar user={user} size={28} />
            <button
              type="button"
              className="link"
              onClick={() => void logout().then(() => navigate('/login'))}
            >
              {m.nav.signOut}
            </button>
          </span>
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <footer className="footer">
        <LanguageSwitch />
      </footer>
    </div>
  );
}

/** Tela que exige uma permissão: sem ela, mostra "acesso negado" (a API também recusaria). */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { m } = useI18n();
  const { user } = useAuth();
  if (can(user, permission)) return <>{children}</>;
  return (
    <section className="card">
      <h1>{m.forbidden.title}</h1>
      <p className="muted">{m.forbidden.text}</p>
      <p className="links">
        <Link to="/">{m.notFound.back}</Link>
      </p>
    </section>
  );
}
