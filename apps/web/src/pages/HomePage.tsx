import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { can } from '../auth/permissions';
import { Icon } from '../components/Icon';
import { useLoginMethods } from '../components/Reauth';
import { Avatar, Badge, ErrorAlert, PageHeader } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { describeUserAgent, formatDateTime } from '../lib/format';
import { useQuery } from '../lib/hooks';

/**
 * Início. A pergunta da tela: "minha conta está protegida, e falta fazer algo?".
 * A resposta é o maior bloco (Proteção da conta), com a próxima ação ao lado de cada item.
 * Quem administra vê também os números de usuários e a atividade recente.
 */
export function HomePage() {
  const { m, f } = useI18n();
  const { user } = useAuth();
  const methods = useLoginMethods();
  const [resent, setResent] = useState(false);

  if (!user) return null;

  const resend = async () => {
    const { error } = await api.POST('/api/v1/auth/email/resend');
    if (!error) setResent(true);
  };

  const hasPassword = methods.data?.hasPassword ?? true;
  const checks: { ok: boolean; title: string; meta: string; action: ReactNode }[] = [
    {
      ok: !!user.emailVerifiedAt,
      title: user.emailVerifiedAt ? m.home.emailOk : m.home.emailMissing,
      meta: f(m.home.emailMeta, { email: user.email }),
      action: resent ? (
        <span className="muted">{m.home.resent}</span>
      ) : (
        <button type="button" onClick={() => void resend()}>
          {m.home.resend}
        </button>
      ),
    },
    {
      ok: hasPassword,
      title: hasPassword ? m.home.passwordOk : m.home.passwordMissing,
      meta: m.home.passwordMeta,
      action: (
        <Link className="button" to="/account">
          {m.home.create}
        </Link>
      ),
    },
    {
      ok: !!user.twoFactorEnabledAt,
      title: user.twoFactorEnabledAt ? m.home.twoFactorOk : m.home.twoFactorMissing,
      meta: m.home.twoFactorMeta,
      action: (
        <Link className="button" to="/account/security">
          {m.home.setUp}
        </Link>
      ),
    },
  ];
  const done = checks.filter((c) => c.ok).length;
  const missing = checks.filter((c) => !c.ok);
  const finding =
    missing.length === 0
      ? m.home.allSet
      : missing.length === 1
        ? f(m.home.missingOne, { step: missing[0]!.title.toLowerCase() })
        : f(m.home.missingMany, {
            n: String(missing.length),
            step: missing[0]!.title.toLowerCase(),
          });

  return (
    <>
      <PageHeader title={f(m.home.hello, { name: user.name.split(' ')[0]! })} subtitle={finding} />

      <div className="home-grid">
        <section className="card" aria-labelledby="protection">
          <div className="card-head">
            <h2 id="protection">{m.home.protection}</h2>
          </div>
          <div className="score">
            <strong className="num">
              {done}
              <span className="muted"> / {checks.length}</span>
            </strong>
          </div>
          <p className="muted">
            {f(m.home.score, { done: String(done), total: String(checks.length) })}
          </p>
          <div className="meter" aria-hidden="true">
            {checks.map((c, i) => (
              <span key={i} className={c.ok ? 'on' : undefined} />
            ))}
          </div>
          <ul className="rows">
            {checks.map((c) => (
              <li key={c.title}>
                <div className="person">
                  <span className={c.ok ? 'check on' : 'check'}>
                    <Icon name={c.ok ? 'check' : 'dash'} size={12} />
                  </span>
                  <div className="row-main">
                    <span className="row-title">{c.title}</span>
                    <span className="row-meta">{c.meta}</span>
                  </div>
                </div>
                {!c.ok && c.action}
              </li>
            ))}
          </ul>
        </section>

        <DevicesCard />
      </div>

      {can(user, 'users:read') && <AdminOverview />}
    </>
  );
}

function DevicesCard() {
  const { m, lang } = useI18n();
  const sessions = useQuery(() => api.GET('/api/v1/users/me/sessions'), []);
  const list = sessions.data ?? [];

  return (
    <section className="card stretch" aria-labelledby="devices">
      <div className="card-head">
        <h2 id="devices">
          {m.home.devices} <span className="muted num">{sessions.data ? list.length : ''}</span>
        </h2>
      </div>
      <ErrorAlert error={sessions.error} />
      <ul className="rows">
        {list.slice(0, 3).map((s) => (
          <li key={s.id}>
            <div className="row-main">
              <span className="row-title">
                {describeUserAgent(s.userAgent) ?? m.security.unknownDevice}
                {s.current && <Badge tone="accent">{m.security.thisDevice}</Badge>}
              </span>
              <span className="row-meta">
                <span className="mono">{s.ip ?? '—'}</span> ·{' '}
                {formatDateTime(lang, s.lastUsedAt ?? s.createdAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="card-foot">
        <Link to="/account/security">{m.home.viewAll}</Link>
      </div>
    </section>
  );
}

/** Contagens do console: cada número vem do total da própria lista filtrada (nada digitado à mão). */
function AdminOverview() {
  const { m } = useI18n();
  const { user } = useAuth();
  const count = (query: { role?: 'admin' | 'manager'; deleted?: boolean }) =>
    api
      .GET('/api/v1/users', { params: { query: { limit: 1, ...query } } })
      .then((r) => ({ data: r.data?.meta.total, error: r.error }));

  const active = useQuery(() => count({}), []);
  const admins = useQuery(() => count({ role: 'admin' }), []);
  const managers = useQuery(() => count({ role: 'manager' }), []);
  const deleted = useQuery(() => count({ deleted: true }), []);

  const kpis = [
    { label: m.home.activeUsers, value: active.data, to: '/admin/users' },
    { label: m.home.admins, value: admins.data, to: '/admin/users?role=admin' },
    { label: m.home.managers, value: managers.data, to: '/admin/users?role=manager' },
    { label: m.home.deletedUsers, value: deleted.data, to: '/admin/users?deleted=1' },
  ];

  return (
    <>
      <div className="section-title">
        <h2>{m.home.admin}</h2>
      </div>
      <div className="kpis">
        {kpis.map((k) => (
          <Link key={k.label} to={k.to} className="kpi">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.value ?? '—'}</div>
          </Link>
        ))}
      </div>
      <div className="home-grid admin-grid">
        {can(user, 'audit:read') && <RecentActivity />}
        <NeedsAttention />
      </div>
    </>
  );
}

/** Os últimos eventos, em duas linhas: o que aconteceu / de onde; a hora à direita. */
function RecentActivity() {
  const { m, lang } = useI18n();
  const logs = useQuery(
    () => api.GET('/api/v1/audit-logs', { params: { query: { limit: 5 } } }),
    [],
  );

  return (
    <section className="card stretch" aria-labelledby="activity">
      <div className="card-head">
        <h2 id="activity">{m.home.recentActivity}</h2>
      </div>
      <ErrorAlert error={logs.error} />
      <ul className="rows">
        {logs.data?.data.map((log) => (
          <li key={log.id}>
            <div className="row-main">
              <span className="row-title">{m.auditActions[log.action] ?? log.action}</span>
              <span className="row-meta mono">{log.ip ?? '—'}</span>
            </div>
            <span className="muted nowrap">{formatDateTime(lang, log.createdAt)}</span>
          </li>
        ))}
      </ul>
      <div className="card-foot">
        <Link to="/admin/audit">{m.home.viewAudit}</Link>
      </div>
    </section>
  );
}

/**
 * Quem precisa de uma ação do admin: e-mail não confirmado (o convite pode ter se perdido) ou
 * conta desativada. Lista curta, cada pessoa com o motivo; o clique abre o detalhe.
 */
function NeedsAttention() {
  const { m } = useI18n();
  const users = useQuery(() => api.GET('/api/v1/users', { params: { query: { limit: 100 } } }), []);
  const flagged = (users.data?.data ?? []).filter((u) => !u.emailVerifiedAt || !u.isActive);

  return (
    <section className="card stretch" aria-labelledby="attention">
      <div className="card-head">
        <h2 id="attention">
          {m.home.attention} <span className="muted num">{users.data ? flagged.length : ''}</span>
        </h2>
      </div>
      <ErrorAlert error={users.error} />
      {users.data && flagged.length === 0 && <p className="muted">{m.home.attentionEmpty}</p>}
      <ul className="rows">
        {flagged.slice(0, 5).map((u) => (
          <li key={u.id}>
            <Link to={`/admin/users/${u.id}`} className="person plain">
              <Avatar user={u} size={32} />
              <span className="row-main">
                <span className="row-title">{u.name}</span>
                <span className="row-meta">{u.email}</span>
              </span>
            </Link>
            <Badge tone={u.isActive ? 'warning' : 'danger'}>
              {u.isActive ? m.users.unverified : m.users.inactive}
            </Badge>
          </li>
        ))}
      </ul>
      <div className="card-foot">
        <Link to="/admin/users">{m.home.viewAll}</Link>
      </div>
    </section>
  );
}

export function NotFoundPage() {
  const { m } = useI18n();
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>{m.notFound.title}</h1>
        <p className="links">
          <Link to="/">{m.notFound.back}</Link>
        </p>
      </div>
    </main>
  );
}
