import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { can, ROLES, type Role } from '../../auth/permissions';
import type { User } from '../../auth/session';
import {
  Avatar,
  Checkbox,
  ConfirmDialog,
  ErrorAlert,
  Field,
  fieldError,
  FormError,
  PageHeader,
  Section,
  SelectField,
  SuccessAlert,
  useLanguageOptions,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n/I18nProvider';
import type { Language } from '../../i18n/language';
import { formatDateTime } from '../../lib/format';
import { useAction, useQuery } from '../../lib/hooks';
import { UserStatus } from './UsersPage';

/** /admin/users/:id — dados, role e ações de um usuário. Cada bloco aparece só com a permissão dele. */
export function UserDetailPage() {
  const { m } = useI18n();
  const { id = '' } = useParams();
  const { user: me } = useAuth();
  const query = useQuery(() => api.GET('/api/v1/users/{id}', { params: { path: { id } } }), [id]);
  const user = query.data;

  const back = (
    <Link to="/admin/users" className="back">
      <Icon name="back" />
      {m.user.back}
    </Link>
  );

  if (query.loading && !user) return <p className="loading-line">{m.common.loading}</p>;
  if (!user) {
    return (
      <>
        {back}
        <ErrorAlert error={query.error} />
      </>
    );
  }

  const changed = (next: User) => query.setData(next);

  return (
    <>
      {back}
      <PageHeader
        lead={<Avatar user={user} size={48} />}
        title={user.name}
        subtitle={`${user.email} · ${m.roles[user.role]}`}
        actions={(!user.isActive || !user.emailVerifiedAt) && <UserStatus user={user} />}
      />

      <InfoSection user={user} />
      {can(me, 'users:update') && <DetailsForm user={user} onSaved={changed} />}
      {can(me, 'users:manage-roles') && <RoleForm user={user} onSaved={changed} />}
      <ActionsSection user={user} onChanged={query.reload} />
    </>
  );
}

function InfoSection({ user }: { user: User }) {
  const { m, lang } = useI18n();
  const { user: me } = useAuth();
  const rows: [string, ReactNode][] = [
    [
      m.user.id,
      <span className="mono" title={user.id}>
        {user.id.slice(0, 8)}…
      </span>,
    ],
    [
      m.user.emailVerified,
      user.emailVerifiedAt ? formatDateTime(lang, user.emailVerifiedAt) : m.common.no,
    ],
    [
      m.user.twoFactor,
      user.twoFactorEnabledAt ? formatDateTime(lang, user.twoFactorEnabledAt) : m.common.no,
    ],
    [m.users.language, user.locale ?? '—'],
    [m.user.createdAt, formatDateTime(lang, user.createdAt)],
    [m.user.updatedAt, formatDateTime(lang, user.updatedAt)],
  ];
  return (
    <Section title={m.user.info} help={m.user.infoHelp}>
      <dl className="info">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {can(me, 'audit:read') && (
        <div className="panel-actions">
          <Link className="button" to={`/admin/audit?targetId=${user.id}`}>
            {m.user.activity}
          </Link>
        </div>
      )}
    </Section>
  );
}

function DetailsForm({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const { m, lang } = useI18n();
  const languages = useLanguageOptions();
  // Sem idioma salvo, o select mostra o da tela — mas só é gravado se o admin mudar
  const shownLocale = (user.locale ?? lang) as Language;
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    locale: shownLocale,
    isActive: user.isActive,
  });
  const [saved, setSaved] = useState(false);
  const { run, busy, error } = useAction();

  // Outro bloco atualizou o usuário (ex.: role): recarrega o formulário
  useEffect(() => {
    setForm({ name: user.name, email: user.email, locale: shownLocale, isActive: user.isActive });
  }, [user, shownLocale]);

  const changed =
    form.name.trim() !== user.name ||
    form.email.trim() !== user.email ||
    form.isActive !== user.isActive ||
    form.locale !== shownLocale;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed) return;
    setSaved(false);
    const { locale, ...rest } = form;
    void run(async () => {
      const { data, error: apiError } = await api.PATCH('/api/v1/users/{id}', {
        params: { path: { id: user.id } },
        body: { ...rest, ...(user.locale || locale !== shownLocale ? { locale } : {}) },
      });
      if (apiError || !data) throw apiError;
      onSaved(data);
      setSaved(true);
    });
  }

  return (
    <Section title={m.user.details} help={m.user.detailsHelp}>
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
        <SelectField
          label={m.users.language}
          value={form.locale}
          onChange={(e) => setForm({ ...form, locale: e.target.value as Language })}
          options={languages}
        />
        <Checkbox
          label={m.user.accountActive}
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        <FormError error={error} />
        {saved && <SuccessAlert>{m.common.saved}</SuccessAlert>}
        <div className="panel-actions">
          <button
            type="submit"
            disabled={busy || !changed || !form.name.trim() || !form.email.trim()}
          >
            {m.common.save}
          </button>
        </div>
      </form>
    </Section>
  );
}

function RoleForm({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const { m, f } = useI18n();
  const [role, setRole] = useState<Role>(user.role);
  const [saved, setSaved] = useState(false);
  const { run, busy, error } = useAction();

  useEffect(() => setRole(user.role), [user.role]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    void run(async () => {
      const { data, error: apiError } = await api.PATCH('/api/v1/users/{id}/role', {
        params: { path: { id: user.id } },
        body: { role },
      });
      if (apiError || !data) throw apiError;
      onSaved(data);
      setSaved(true);
    });
  }

  return (
    <Section
      title={m.user.roleTitle}
      help={f(m.user.roleHelp, {
        permissions: user.permissions.join(', ') || m.user.noPermissions,
      })}
    >
      <form onSubmit={submit} noValidate>
        <SelectField
          label={m.users.role}
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          options={ROLES.map((r) => ({ value: r, label: m.roles[r] }))}
          error={fieldError(error, 'role')}
        />
        <FormError error={error} />
        {saved && <SuccessAlert>{m.common.saved}</SuccessAlert>}
        <div className="panel-actions">
          <button type="submit" disabled={busy || role === user.role}>
            {m.user.changeRole}
          </button>
        </div>
      </form>
    </Section>
  );
}

type Pending = 'reset2fa' | 'delete' | null;

function ActionsSection({ user, onChanged }: { user: User; onChanged: () => void }) {
  const { m, f } = useI18n();
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { run, busy, error, setError } = useAction();

  const canInvite = can(me, 'users:create');
  const canReset2fa = can(me, 'users:reset-2fa') && !!user.twoFactorEnabledAt;
  const canDelete = can(me, 'users:delete') && user.id !== me?.id;
  if (!canInvite && !canReset2fa && !canDelete) return null;

  const invite = () =>
    void run(async () => {
      setNotice(null);
      const { error: apiError } = await api.POST('/api/v1/users/{id}/invite', {
        params: { path: { id: user.id } },
      });
      if (apiError) throw apiError;
      setNotice(m.user.inviteSent);
    });

  const confirm = () =>
    void run(async () => {
      const params = { params: { path: { id: user.id } } };
      if (pending === 'reset2fa') {
        const { error: apiError } = await api.DELETE('/api/v1/users/{id}/two-factor', params);
        if (apiError) throw apiError;
        setPending(null);
        setNotice(m.user.reset2faDone);
        onChanged();
      } else {
        const { error: apiError } = await api.DELETE('/api/v1/users/{id}', params);
        if (apiError) throw apiError;
        navigate('/admin/users?deleted=1', { replace: true });
      }
    });

  const open = (p: Pending) => {
    setError(null);
    setPending(p);
  };

  return (
    <>
      {(canInvite || canReset2fa) && (
        <Section title={m.user.actions} help={m.user.actionsHelp}>
          <ul className="rows">
            {canInvite && (
              <li>
                <div className="row-main">
                  <span className="row-title">{m.user.resendInvite}</span>
                  <span className="row-meta">{m.user.resendInviteHelp}</span>
                </div>
                <button type="button" disabled={busy} onClick={invite}>
                  {m.user.resendInvite}
                </button>
              </li>
            )}
            {canReset2fa && (
              <li>
                <div className="row-main">
                  <span className="row-title">{m.user.reset2fa}</span>
                  <span className="row-meta">{m.user.reset2faHelp}</span>
                </div>
                <button type="button" onClick={() => open('reset2fa')}>
                  {m.user.reset2faShort}
                </button>
              </li>
            )}
          </ul>
          {notice && <SuccessAlert>{notice}</SuccessAlert>}
          {!pending && <ErrorAlert error={error} />}
        </Section>
      )}

      {canDelete && (
        <Section title={m.user.delete} help={m.user.deleteHelp} danger>
          <p>{f(m.user.deleteWhat, { name: user.name })}</p>
          <div className="panel-actions">
            <button type="button" className="danger" onClick={() => open('delete')}>
              {m.user.delete}
            </button>
          </div>
        </Section>
      )}

      {pending && (
        <ConfirmDialog
          title={
            pending === 'delete'
              ? f(m.user.deleteConfirm, { name: user.name })
              : f(m.user.reset2faConfirm, { name: user.name })
          }
          text={pending === 'delete' ? m.user.deleteHelp : m.user.reset2faHelp}
          confirmLabel={pending === 'delete' ? m.user.delete : m.user.reset2fa}
          busy={busy}
          error={error}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
