import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../api/client';
import { FILE_LIMITS, uploadFile } from '../../api/upload';
import { useAuth } from '../../auth/AuthProvider';
import { session } from '../../auth/session';
import { emptyReauth, reauthBody, ReauthFields, useLoginMethods } from '../../components/Reauth';
import {
  Avatar,
  ErrorAlert,
  Field,
  fieldError,
  FormError,
  Section,
  SelectField,
  SuccessAlert,
  useLanguageOptions,
} from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import type { Language } from '../../i18n/language';
import { formatBytes } from '../../lib/format';
import { useAction } from '../../lib/hooks';

/** /account — foto, dados pessoais, e-mail e senha. */
export function ProfilePage() {
  const { m } = useI18n();
  const methods = useLoginMethods();
  const hasPassword = methods.data?.hasPassword ?? true;

  return (
    <>
      <h1>{m.profile.title}</h1>
      <PhotoSection />
      <DetailsSection />
      <EmailSection hasPassword={hasPassword} />
      <PasswordSection hasPassword={hasPassword} onCreated={methods.reload} />
    </>
  );
}

function PhotoSection() {
  const { m, f } = useI18n();
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const { run, busy, error, setError } = useAction();
  const limits = FILE_LIMITS.avatar;
  const maxSize = formatBytes(limits.maxSize);

  if (!user) return null;

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    if (!limits.contentTypes.includes(file.type)) {
      return setError({ statusCode: 0, code: 'client', message: m.profile.photoInvalidType });
    }
    if (file.size > limits.maxSize) {
      return setError({
        statusCode: 0,
        code: 'client',
        message: f(m.profile.photoTooBig, { size: maxSize }),
      });
    }
    void run(async () => {
      const uploaded = await uploadFile(file, 'avatar');
      const { data, error: apiError } = await api.PUT('/api/v1/users/me/avatar', {
        body: { fileId: uploaded.id },
      });
      if (apiError || !data) throw apiError;
      session.setUser(data);
    });
  }

  const remove = () =>
    void run(async () => {
      const { data, error: apiError } = await api.DELETE('/api/v1/users/me/avatar');
      if (apiError || !data) throw apiError;
      session.setUser(data);
    });

  return (
    <Section title={m.profile.photo}>
      <div className="profile">
        <Avatar user={user} size={72} />
        <div className="stack">
          <div className="row">
            <button type="button" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? m.profile.uploading : m.profile.changePhoto}
            </button>
            {user.avatarUrl && (
              <button type="button" className="secondary" disabled={busy} onClick={remove}>
                {m.profile.removePhoto}
              </button>
            )}
          </div>
          <small className="hint">{f(m.profile.photoHint, { size: maxSize })}</small>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={limits.contentTypes.join(',')}
        hidden
        onChange={onFile}
        data-testid="avatar-input"
      />
      <ErrorAlert error={error} />
    </Section>
  );
}

function DetailsSection() {
  const { m, lang, setLang } = useI18n();
  const { user } = useAuth();
  const languages = useLanguageOptions();
  const [name, setName] = useState(user?.name ?? '');
  const [locale, setLocale] = useState<Language>((user?.locale as Language | null) ?? lang);
  const [saved, setSaved] = useState(false);
  const { run, busy, error } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    void run(async () => {
      const { data, error: apiError } = await api.PATCH('/api/v1/users/me', {
        body: { name, locale },
      });
      if (apiError || !data) throw apiError;
      session.setUser(data);
      setLang(locale); // a interface acompanha o idioma escolhido
      setSaved(true);
    });
  }

  return (
    <Section title={m.profile.details}>
      <form onSubmit={submit} noValidate>
        <Field
          label={m.common.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
          error={fieldError(error, 'name')}
        />
        <SelectField
          label={m.profile.preferredLanguage}
          hint={m.profile.preferredLanguageHint}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Language)}
          options={languages}
          error={fieldError(error, 'locale')}
        />
        <FormError error={error} />
        {saved && <SuccessAlert>{m.common.saved}</SuccessAlert>}
        <button type="submit" disabled={busy}>
          {m.common.save}
        </button>
      </form>
    </Section>
  );
}

function EmailSection({ hasPassword }: { hasPassword: boolean }) {
  const { m, f } = useI18n();
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [reauth, setReauth] = useState(emptyReauth);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { run, busy, error } = useAction();

  if (!user) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/users/me/email', {
        body: { newEmail, ...reauthBody(reauth) },
      });
      if (apiError || !data) throw apiError;
      session.setUser({ ...user!, pendingEmail: data.pendingEmail });
      setSentTo(data.pendingEmail);
      setNewEmail('');
      setReauth(emptyReauth);
    });
  }

  return (
    <Section title={m.profile.emailTitle} help={f(m.profile.currentEmail, { email: user.email })}>
      {sentTo ? (
        <SuccessAlert>{f(m.profile.emailSent, { email: sentTo })}</SuccessAlert>
      ) : (
        user.pendingEmail && (
          <p className="alert alert-warning">
            {f(m.profile.pendingEmail, { email: user.pendingEmail })}
          </p>
        )
      )}
      <form onSubmit={submit} noValidate>
        <Field
          label={m.profile.newEmail}
          type="email"
          autoComplete="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          required
          error={fieldError(error, 'newEmail')}
        />
        <ReauthFields value={reauth} onChange={setReauth} error={error} hasPassword={hasPassword} />
        <FormError error={error} />
        <button type="submit" disabled={busy}>
          {m.profile.changeEmail}
        </button>
      </form>
    </Section>
  );
}

function PasswordSection({
  hasPassword,
  onCreated,
}: {
  hasPassword: boolean;
  onCreated: () => void;
}) {
  const { m } = useI18n();
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false);
  const { run, busy, error } = useAction();

  if (!user) return null;

  // Conta só com Google/Apple: a primeira senha é criada pelo link do e-mail
  if (!hasPassword) {
    const sendLink = () =>
      void run(async () => {
        const { error: apiError } = await api.POST('/api/v1/auth/password/forgot', {
          body: { email: user.email },
        });
        if (apiError) throw apiError;
        setDone(true);
        onCreated();
      });
    return (
      <Section title={m.profile.passwordTitle} help={m.profile.noPassword}>
        {done ? (
          <SuccessAlert>{m.profile.passwordLinkSent}</SuccessAlert>
        ) : (
          <button type="button" disabled={busy} onClick={sendLink}>
            {m.profile.sendPasswordLink}
          </button>
        )}
        <ErrorAlert error={error} />
      </Section>
    );
  }

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    setMismatch(form.newPassword !== form.confirm);
    if (form.newPassword !== form.confirm) return;
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/auth/password/change', {
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      if (apiError || !data) throw apiError;
      // A API encerra todas as sessões e devolve um par novo para este dispositivo
      session.start(data);
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setDone(true);
    });
  }

  return (
    <Section title={m.profile.passwordTitle}>
      <form onSubmit={submit} noValidate>
        <Field
          label={m.profile.currentPassword}
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={set('currentPassword')}
          required
          error={fieldError(error, 'currentPassword')}
        />
        <Field
          label={m.profile.newPassword}
          type="password"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={set('newPassword')}
          required
          hint={m.common.passwordHint}
          error={fieldError(error, 'newPassword')}
        />
        <Field
          label={m.profile.confirmPassword}
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          required
          error={mismatch ? m.reset.mismatch : undefined}
        />
        <FormError error={error} />
        {done && <SuccessAlert>{m.profile.passwordChanged}</SuccessAlert>}
        <button type="submit" disabled={busy}>
          {m.profile.changePassword}
        </button>
      </form>
    </Section>
  );
}
