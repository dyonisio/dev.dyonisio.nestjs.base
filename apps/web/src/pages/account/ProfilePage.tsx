import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../api/client';
import { FILE_LIMITS, uploadFile } from '../../api/upload';
import { AvatarCropper } from '../../components/AvatarCropper';
import { useAuth } from '../../auth/AuthProvider';
import { session } from '../../auth/session';
import { ReauthDialog, useLoginMethods, type ReauthProof } from '../../components/Reauth';
import {
  Avatar,
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
import { useI18n } from '../../i18n/I18nProvider';
import type { Language } from '../../i18n/language';
import { formatBytes, formatDate } from '../../lib/format';
import { CreatePasswordForm } from '../MagicLinkPages';
import { useAction } from '../../lib/hooks';

/** Maior foto que o navegador abre para recortar (a que sobe é o recorte, bem menor). */
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;

/** /account — foto, dados pessoais, e-mail e senha. */
export function ProfilePage() {
  const { m, f, lang } = useI18n();
  const { user } = useAuth();
  const methods = useLoginMethods();
  const hasPassword = methods.data?.hasPassword ?? true;

  return (
    <>
      <PageHeader
        title={m.profile.title}
        subtitle={
          user &&
          f(m.profile.subtitle, { email: user.email, date: formatDate(lang, user.createdAt) })
        }
      />
      <PhotoSection />
      <DetailsSection />
      <EmailSection />
      <PasswordSection hasPassword={hasPassword} onCreated={methods.reload} />
    </>
  );
}

function PhotoSection() {
  const { m, f } = useI18n();
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const { run, busy, error, setError } = useAction();
  const limits = FILE_LIMITS.avatar;
  // A original só precisa abrir no navegador: o que sobe é o recorte (512×512, dezenas de KB)
  const maxOriginal = formatBytes(MAX_ORIGINAL_BYTES);

  if (!user) return null;

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    if (!limits.contentTypes.includes(file.type)) {
      return setError({ statusCode: 0, code: 'client', message: m.profile.photoInvalidType });
    }
    if (file.size > MAX_ORIGINAL_BYTES) {
      return setError({
        statusCode: 0,
        code: 'client',
        message: f(m.profile.photoTooBig, { size: maxOriginal }),
      });
    }
    setError(null);
    setCropping(file);
  }

  function upload(file: File) {
    setCropping(null);
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
    <Section title={m.profile.photo} help={m.profile.photoHelp}>
      <div className="profile">
        <Avatar user={user} size={72} />
        <div className="stack">
          <div className="panel-actions start">
            <button type="button" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? m.profile.uploading : m.profile.changePhoto}
            </button>
            {user.avatarUrl && (
              <button type="button" disabled={busy} onClick={remove}>
                {m.profile.removePhoto}
              </button>
            )}
          </div>
          <small className="hint">{m.profile.photoHint}</small>
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
      {cropping && (
        <AvatarCropper file={cropping} onCancel={() => setCropping(null)} onCropped={upload} />
      )}
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
  // Salvar só acende quando algo mudou (e o nome não está vazio). Conta sem idioma salvo conta
  // como mudança: o seletor mostra o idioma da tela, mas os e-mails ainda saem no padrão.
  const localeSaved = !!user?.locale;
  const changed = name.trim() !== (user?.name ?? '') || locale !== user?.locale;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed) return;
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
    <Section title={m.profile.details} help={m.profile.detailsHelp}>
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
          hint={localeSaved ? m.profile.preferredLanguageHint : m.profile.localeNotSaved}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Language)}
          options={languages}
          error={fieldError(error, 'locale')}
        />
        <FormError error={error} />
        {saved && <SuccessAlert>{m.common.saved}</SuccessAlert>}
        <div className="panel-actions">
          <button type="submit" disabled={busy || !changed || !name.trim()}>
            {m.common.save}
          </button>
        </div>
      </form>
    </Section>
  );
}

function EmailSection() {
  const { m, f } = useI18n();
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!user) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSentTo(null);
    if (newEmail.trim()) setConfirming(true);
  };

  const change = async (proof: ReauthProof) => {
    const { data, error: apiError } = await api.POST('/api/v1/users/me/email', {
      body: { newEmail, ...proof },
    });
    if (apiError || !data) throw apiError;
    session.setUser({ ...user, pendingEmail: data.pendingEmail });
    setSentTo(data.pendingEmail);
    setNewEmail('');
    setConfirming(false);
  };

  return (
    <Section title={m.profile.emailTitle} help={f(m.profile.currentEmail, { email: user.email })}>
      {sentTo ? (
        <SuccessAlert>{f(m.profile.emailSent, { email: sentTo })}</SuccessAlert>
      ) : (
        user.pendingEmail && (
          <p className="alert alert-warning panel-alert">
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
          hint={m.profile.newEmailHint}
          required
        />
        <div className="panel-actions">
          <button type="submit" disabled={!newEmail.trim()}>
            {m.profile.changeEmail}
          </button>
        </div>
      </form>
      {confirming && (
        <ReauthDialog
          title={m.profile.changeEmail}
          text={f(m.profile.emailDialog, { email: newEmail })}
          confirmLabel={m.profile.changeEmail}
          onConfirm={change}
          onClose={() => setConfirming(false)}
        />
      )}
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

  // Conta sem senha (Google/Apple, ou convite): cria a primeira senha aqui mesmo
  if (!hasPassword) {
    return (
      <Section title={m.profile.passwordTitle} help={m.profile.noPassword}>
        {done ? (
          <SuccessAlert>{m.createPassword.done}</SuccessAlert>
        ) : (
          <CreatePasswordForm
            onDone={() => {
              setDone(true);
              onCreated();
            }}
          />
        )}
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
        <div className="panel-actions">
          <button
            type="submit"
            disabled={busy || !form.currentPassword || !form.newPassword || !form.confirm}
          >
            {m.profile.changePassword}
          </button>
        </div>
      </form>
    </Section>
  );
}
