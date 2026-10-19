import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { can, ROLES, type Role } from '../../auth/permissions';
import type { User } from '../../auth/session';
import { Icon } from '../../components/Icon';
import {
  Avatar,
  Badge,
  ErrorAlert,
  Field,
  fieldError,
  FormError,
  Modal,
  PageHeader,
  Pager,
  SelectField,
  SuccessAlert,
  useLanguageOptions,
} from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import type { Language } from '../../i18n/language';
import { formatDate } from '../../lib/format';
import { useAction, useQuery } from '../../lib/hooks';

const SORTS = {
  newest: { sortBy: 'createdAt', order: 'desc' },
  oldest: { sortBy: 'createdAt', order: 'asc' },
  nameAz: { sortBy: 'name', order: 'asc' },
  emailAz: { sortBy: 'email', order: 'asc' },
} as const;
type Sort = keyof typeof SORTS;

/**
 * /admin/users — lista com busca, filtros e paginação (permissão `users:read`).
 * Os filtros ficam na URL: dá para recarregar ou mandar o link sem perder a busca.
 */
export function UsersPage() {
  const { m, f, lang } = useI18n();
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { run, busy, error } = useAction();

  const page = Number(params.get('page') ?? 1) || 1;
  const role = (params.get('role') ?? '') as Role | '';
  const sort = (params.get('sort') ?? 'newest') as Sort;
  const deleted = params.get('deleted') === '1';
  const search = params.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(search);

  /** Muda um filtro e volta para a página 1. */
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Busca enquanto digita, com uma pausa para não chamar a API a cada tecla
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => update({ search: searchInput.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const users = useQuery(
    () =>
      api.GET('/api/v1/users', {
        params: {
          query: {
            page,
            limit: 20,
            ...(role ? { role } : {}),
            ...(search ? { search } : {}),
            ...SORTS[sort],
            deleted,
          },
        },
      }),
    [page, role, sort, deleted, search],
  );

  const restore = (u: User) =>
    void run(async () => {
      const { error: apiError } = await api.PATCH('/api/v1/users/{id}/restore', {
        params: { path: { id: u.id } },
      });
      if (apiError) throw apiError;
      setNotice(m.users.restored);
      users.reload();
    });

  const meta = users.data?.meta;
  const rows = users.data?.data ?? [];

  return (
    <>
      <PageHeader
        title={m.users.title}
        subtitle={
          meta
            ? f(deleted ? m.users.totalDeleted : m.users.total, { n: String(meta.total) })
            : m.common.loading
        }
        actions={
          can(me, 'users:create') && (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              {m.users.create}
            </button>
          )
        }
      />

      <div className="tabs" role="tablist">
        {[
          { value: false, label: m.users.tabActive },
          { value: true, label: m.users.tabDeleted },
        ].map((t) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            className="tab"
            aria-selected={deleted === t.value}
            onClick={() => update({ deleted: t.value ? '1' : null })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input
            type="search"
            aria-label={m.users.search}
            placeholder={m.users.search}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="toolbar-group">
          <select
            aria-label={m.users.role}
            value={role}
            onChange={(e) => update({ role: e.target.value || null })}
          >
            <option value="">{m.users.allRoles}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {m.roles[r]}
              </option>
            ))}
          </select>
          <select
            aria-label={m.users.sort}
            value={sort}
            onChange={(e) => update({ sort: e.target.value === 'newest' ? null : e.target.value })}
          >
            {(Object.keys(SORTS) as Sort[]).map((key) => (
              <option key={key} value={key}>
                {m.users[key]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {notice && <SuccessAlert>{notice}</SuccessAlert>}
      <ErrorAlert error={users.error ?? error} />

      {users.loading && !users.data ? (
        <p className="loading-line">{m.common.loading}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{m.users.empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{m.common.name}</th>
                <th className="hide-sm">{m.users.role}</th>
                <th className="hide-sm">{m.users.twoFactor}</th>
                <th>{m.users.status}</th>
                <th className="num hide-sm">{deleted ? m.users.deletedAt : m.users.createdAt}</th>
                {deleted && <th aria-label={m.users.restore} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr
                  key={u.id}
                  className={deleted ? undefined : 'clickable'}
                  onClick={deleted ? undefined : () => navigate(`/admin/users/${u.id}`)}
                >
                  <td>
                    <div className="person">
                      <Avatar user={u} size={32} />
                      <div className="row-main">
                        {deleted ? (
                          <span className="row-title">{u.name}</span>
                        ) : (
                          <Link to={`/admin/users/${u.id}`} onClick={(e) => e.stopPropagation()}>
                            {u.name}
                          </Link>
                        )}
                        <span className="cell-sub">
                          {u.email}
                          <span className="show-sm"> · {m.roles[u.role]}</span>
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="hide-sm">{m.roles[u.role]}</td>
                  <td className="hide-sm">
                    {u.twoFactorEnabledAt ? m.users.on : <span className="muted">—</span>}
                  </td>
                  <td>
                    <UserStatus user={u} />
                  </td>
                  <td className="num muted nowrap hide-sm">
                    {formatDate(lang, deleted ? u.deletedAt : u.createdAt)}
                  </td>
                  {deleted && (
                    <td className="num">
                      {can(me, 'users:delete') && !u.anonymizedAt && (
                        <button type="button" disabled={busy} onClick={() => restore(u)}>
                          {m.users.restore}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta && meta.totalPages > 1 && (
        <Pager
          page={meta.page}
          totalPages={meta.totalPages}
          label={f(m.users.page, {
            page: String(meta.page),
            pages: String(meta.totalPages),
            total: String(meta.total),
          })}
          onPage={(p) => update({ page: p > 1 ? String(p) : null })}
        />
      )}

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(u, invited) => {
            setCreating(false);
            setNotice(m.users.created + (invited ? f(m.users.invited, { email: u.email }) : ''));
            users.reload();
          }}
        />
      )}
    </>
  );
}

/** Situação da conta em uma etiqueta. */
export function UserStatus({ user }: { user: User }) {
  const { m } = useI18n();
  if (user.deletedAt) return <Badge tone="danger">{m.users.deletedShort}</Badge>;
  if (!user.isActive) return <Badge tone="danger">{m.users.inactive}</Badge>;
  if (!user.emailVerifiedAt) return <Badge tone="warning">{m.users.unverified}</Badge>;
  // O normal fica sem cor: a cor vai só para o que precisa de atenção
  return <span className="muted status-ok">{m.users.active}</span>;
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: User, invited: boolean) => void;
}) {
  const { m, lang } = useI18n();
  const { user: me } = useAuth();
  const languages = useLanguageOptions();
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'user' as Role,
    locale: lang as Language,
    password: '',
  });
  const { run, busy, error } = useAction();
  // Dar uma role acima de "user" exige users:manage-roles (a API confere)
  const canChooseRole = can(me, 'users:manage-roles');

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/users', {
        body: {
          name: form.name,
          email: form.email,
          locale: form.locale,
          ...(canChooseRole ? { role: form.role } : {}),
          ...(form.password ? { password: form.password } : {}),
        },
      });
      if (apiError || !data) throw apiError;
      onCreated(data, !form.password);
    });
  }

  return (
    <Modal title={m.users.createTitle} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field
          label={m.common.name}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          error={fieldError(error, 'name')}
        />
        <Field
          label={m.common.email}
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
          error={fieldError(error, 'email')}
        />
        {canChooseRole && (
          <SelectField
            label={m.users.role}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            options={ROLES.map((r) => ({ value: r, label: m.roles[r] }))}
            error={fieldError(error, 'role')}
          />
        )}
        <SelectField
          label={m.users.language}
          value={form.locale}
          onChange={(e) => setForm({ ...form, locale: e.target.value as Language })}
          options={languages}
        />
        <Field
          label={m.users.passwordOptional}
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          hint={m.users.passwordOptionalHint}
          error={fieldError(error, 'password')}
        />
        <FormError error={error} />
        <div className="panel-actions">
          <button type="button" onClick={onClose}>
            {m.common.cancel}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !form.name.trim() || !form.email.trim()}
          >
            {m.users.create}
          </button>
        </div>
      </form>
    </Modal>
  );
}
