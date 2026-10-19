import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { can, type Permission } from '../auth/permissions';
import { useI18n } from '../i18n/I18nProvider';
import { Icon, ProductMark, type IconName } from './Icon';
import { useLoginMethods } from './Reauth';
import { Avatar, LanguageSwitch } from './ui';

interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  permission?: Permission;
}

/**
 * Moldura das telas logadas ("framed sheet"): a barra lateral e a barra superior formam um L no
 * tom da moldura, e a tela fica numa folha branca. No celular a moldura some: a folha vira a tela
 * e o menu abre por cima. Itens de admin só aparecem com a permissão.
 */
export function AppLayout() {
  const { m } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const methods = useLoginMethods();

  useEffect(() => setOpen(false), [pathname]);

  if (!user) return null;
  // Convidado que entrou pelo link e ainda não tem senha nem Google/Apple: cria a senha primeiro
  // (é só a interface que obriga; quem protege as rotas continua sendo a API)
  if (methods.data && !methods.data.hasPassword && methods.data.identities.length === 0) {
    return <Navigate to="/create-password" replace />;
  }

  const all: { label: string; items: NavEntry[] }[] = [
    {
      label: m.nav.groupAccount,
      items: [
        { to: '/', label: m.nav.home, icon: 'home' },
        { to: '/account', label: m.nav.account, icon: 'user' },
        { to: '/account/security', label: m.nav.security, icon: 'shield' },
        { to: '/account/privacy', label: m.nav.privacy, icon: 'lock' },
      ],
    },
    {
      label: m.nav.groupAdmin,
      items: [
        { to: '/admin/users', label: m.nav.users, icon: 'users', permission: 'users:read' },
        { to: '/admin/audit', label: m.nav.audit, icon: 'list', permission: 'audit:read' },
      ],
    },
  ];
  const groups = all
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(user, i.permission)) }))
    .filter((g) => g.items.length > 0);

  // O caminho na barra superior: grupo › tela (a tela mais específica que casa com a URL)
  const current = groups
    .flatMap((g) => g.items.map((i) => ({ group: g.label, ...i })))
    .filter((i) => pathname === i.to || (i.to !== '/' && pathname.startsWith(i.to + '/')))
    .sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <div className="shell">
      <aside className={open ? 'sidebar open' : 'sidebar'} aria-label={m.nav.menu}>
        <Link to="/" className="brand">
          <ProductMark />
          <span>
            {m.appName}
            <small>{m.nav.console}</small>
          </span>
        </Link>
        <button
          type="button"
          className="ghost menu-close"
          aria-label={m.nav.closeMenu}
          onClick={() => setOpen(false)}
        >
          <Icon name="close" />
        </button>

        <nav id="main-nav">
          {groups.map((g) => (
            <div key={g.label} className="nav-group">
              <div className="nav-group-label">{g.label}</div>
              {g.items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  // /account não acende em /account/security; /admin/users acende no detalhe
                  end={i.to === '/' || i.to === '/account'}
                  className="nav-item"
                >
                  <Icon name={i.icon} />
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="account-row">
            <Avatar user={user} size={32} />
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <button
            type="button"
            className="ghost nav-item signout"
            onClick={() => void logout().then(() => navigate('/login'))}
          >
            <Icon name="logout" />
            {m.nav.signOut}
          </button>
        </div>
      </aside>

      <header className="topbar">
        <div className="crumbs">
          <button
            type="button"
            className="ghost menu-toggle"
            aria-expanded={open}
            aria-controls="main-nav"
            aria-label={m.nav.menu}
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" />
          </button>
          {current && (
            <>
              <span className="hide-sm">{current.group}</span>
              <span className="hide-sm" aria-hidden="true">
                /
              </span>
              <strong>{current.label}</strong>
            </>
          )}
        </div>
        <div className="topbar-actions">
          <LanguageSwitch />
        </div>
      </header>

      <main className="sheet">
        <div className="sheet-inner">
          <Outlet />
        </div>
      </main>
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
    <section className="forbidden">
      <h1>{m.forbidden.title}</h1>
      <p className="muted">{m.forbidden.text}</p>
      <p className="panel-actions start">
        <Link to="/">{m.notFound.back}</Link>
      </p>
    </section>
  );
}
