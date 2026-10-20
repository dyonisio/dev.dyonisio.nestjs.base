import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { api, type ApiError } from '../../api/client';
import type { components } from '../../api/schema';
import { useAuth } from '../../auth/AuthProvider';
import {
  createPasskey,
  PasskeyBrowserError,
  passkeyFailureMessage,
  passkeysSupported,
} from '../../auth/passkey';
import {
  emptyReauth,
  PasskeyConfirm,
  reauthBody,
  ReauthDialog,
  ReauthFields,
  refreshLoginMethods,
  useLoginMethods,
  type ReauthProof,
} from '../../components/Reauth';
import {
  Badge,
  ConfirmDialog,
  ErrorAlert,
  Field,
  fieldError,
  FormError,
  Modal,
  PageHeader,
  Section,
  SuccessAlert,
} from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import { describeUserAgent, formatDate, formatDateTime } from '../../lib/format';
import { useAction, useQuery } from '../../lib/hooks';

/** /account/security — 2FA, dispositivos conectados e formas de login. Destino dos e-mails de alerta. */
export function SecurityPage() {
  const { m } = useI18n();
  const { user } = useAuth();
  const methods = useLoginMethods();

  return (
    <>
      <PageHeader
        title={m.security.title}
        subtitle={user?.twoFactorEnabledAt ? m.security.subtitleOn : m.security.subtitleOff}
      />
      <TwoFactorSection hasPassword={methods.data?.hasPassword ?? true} />
      <PasskeysSection />
      <SessionsSection />
      <MethodsSection methods={methods} />
    </>
  );
}

// ---------------------------------------------------------------- 2FA

type TwoFactorStep =
  | { name: 'idle' }
  | { name: 'reauth' }
  | { name: 'scan'; secret: string; qr: string }
  | { name: 'codes'; codes: string[] }
  | { name: 'disable' }
  | { name: 'regenerate' };

function TwoFactorSection({ hasPassword }: { hasPassword: boolean }) {
  const { m, f, lang } = useI18n();
  const { user, reloadUser } = useAuth();
  const [step, setStep] = useState<TwoFactorStep>({ name: 'idle' });
  const [reauth, setReauth] = useState(emptyReauth);
  const [code, setCode] = useState('');
  const { run, busy, error, setError } = useAction();

  if (!user) return null;
  const enabled = !!user.twoFactorEnabledAt;

  const go = (next: TwoFactorStep) => {
    setError(null);
    setCode('');
    setReauth(emptyReauth);
    setStep(next);
  };

  // 1. confirma a identidade (senha, login recente ou passkey) e gera o segredo
  async function setup(proof: ReauthProof) {
    const { data, error: apiError } = await api.POST('/api/v1/auth/2fa/setup', { body: proof });
    if (apiError || !data) throw apiError;
    // QR gerado no navegador: o segredo nunca vai para um serviço de terceiros
    const qr = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 });
    go({ name: 'scan', secret: data.secret, qr });
  }

  const startSetup = (e: FormEvent) => {
    e.preventDefault();
    void run(() => setup(reauthBody(reauth)));
  };

  // 2. confirma com o primeiro código do app → ativa e mostra os códigos de recuperação
  const activate = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/auth/2fa/enable', {
        body: { code: code.trim() },
      });
      if (apiError || !data) throw apiError;
      await reloadUser();
      go({ name: 'codes', codes: data.recoveryCodes });
    });
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { error: apiError } = await api.POST('/api/v1/auth/2fa/disable', {
        body: { code: code.trim() },
      });
      if (apiError) throw apiError;
      await reloadUser();
      go({ name: 'idle' });
    });
  };

  const regenerate = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/auth/2fa/recovery-codes', {
        body: { code: code.trim() },
      });
      if (apiError || !data) throw apiError;
      go({ name: 'codes', codes: data.recoveryCodes });
    });
  };

  const codeField = (
    <Field
      label={m.reauth.code}
      autoComplete="one-time-code"
      inputMode="text"
      value={code}
      onChange={(e) => setCode(e.target.value)}
      required
      error={fieldError(error, 'code')}
    />
  );
  const cancel = (
    <button type="button" onClick={() => go({ name: 'idle' })}>
      {m.common.cancel}
    </button>
  );

  return (
    <Section title={m.security.twoFactor} help={m.security.twoFactorHelp}>
      <div className="status-line">
        <span className="row-main">
          <span className="row-title">
            {enabled ? m.security.on : m.security.off}
            {enabled ? (
              <Badge tone="success">{m.security.active}</Badge>
            ) : (
              <Badge tone="warning">{m.security.inactive}</Badge>
            )}
          </span>
          <span className="row-meta">
            {enabled
              ? f(m.security.enabledSince, { date: formatDate(lang, user.twoFactorEnabledAt) })
              : m.security.disabled}
          </span>
        </span>
        {step.name === 'idle' &&
          (enabled ? (
            <span className="toolbar-group">
              <button type="button" onClick={() => go({ name: 'regenerate' })}>
                {m.security.regenerateShort}
              </button>
              <button type="button" className="danger" onClick={() => go({ name: 'disable' })}>
                {m.security.disable}
              </button>
            </span>
          ) : (
            <button type="button" className="primary" onClick={() => go({ name: 'reauth' })}>
              {m.security.enable}
            </button>
          ))}
      </div>

      {step.name === 'reauth' && (
        <form onSubmit={startSetup} noValidate>
          <ReauthFields
            value={reauth}
            onChange={setReauth}
            error={error}
            hasPassword={hasPassword}
            withCode={false}
          />
          <FormError error={error} />
          <PasskeyConfirm busy={busy} run={run} onProof={setup} />
          <div className="panel-actions">
            {cancel}
            <button
              type="submit"
              className="primary"
              disabled={busy || (hasPassword && !reauth.currentPassword)}
            >
              {m.common.submit}
            </button>
          </div>
        </form>
      )}

      {step.name === 'scan' && (
        <form onSubmit={activate} noValidate className="step">
          <div className="setup">
            <img src={step.qr} alt="QR code" className="qr" width={168} height={168} />
            <div>
              <p>{m.security.scan}</p>
              <p className="muted small step-gap">{m.security.manual}</p>
              <code className="secret">{step.secret}</code>
              <p className="step-gap">{m.security.enterCode}</p>
              {codeField}
            </div>
          </div>
          <FormError error={error} />
          <div className="panel-actions">
            {cancel}
            <button type="submit" className="primary" disabled={busy || !code.trim()}>
              {m.security.activate}
            </button>
          </div>
        </form>
      )}

      {step.name === 'codes' && (
        <RecoveryCodes codes={step.codes} onDone={() => go({ name: 'idle' })} />
      )}

      {(step.name === 'disable' || step.name === 'regenerate') && (
        <form onSubmit={step.name === 'disable' ? disable : regenerate} noValidate>
          <p className="muted">
            {step.name === 'disable' ? m.security.disableHelp : m.security.regenerateHelp}
          </p>
          {codeField}
          <FormError error={error} />
          <div className="panel-actions">
            {cancel}
            <button
              type="submit"
              className={step.name === 'disable' ? 'danger' : undefined}
              disabled={busy || !code.trim()}
            >
              {step.name === 'disable' ? m.security.disable : m.security.regenerate}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { m } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  const copy = () =>
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => undefined,
    );
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([`${m.appName}\n\n${text}\n`], { type: 'text/plain' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="alert alert-warning">
      <strong>{m.security.recoveryTitle}</strong>
      <p>{m.security.recoveryHelp}</p>
      <ul className="codes" aria-label={m.security.recoveryTitle}>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="panel-actions start">
        <button type="button" onClick={copy}>
          {copied ? m.security.copied : m.security.copy}
        </button>
        <button type="button" onClick={download}>
          {m.security.download}
        </button>
        <button type="button" onClick={onDone}>
          {m.security.savedCodes}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- passkeys

type PasskeyDialog =
  | { kind: 'add' }
  | { kind: 'rename' | 'remove'; passkey: components['schemas']['PasskeyDto'] }
  | null;

/**
 * Passkeys: entrar com a digital, o rosto ou o PIN do aparelho. Adicionar pede "confirme que é
 * você" (é uma nova forma de entrar na conta); a API avisa por e-mail.
 */
function PasskeysSection() {
  const { m, f, lang } = useI18n();
  const passkeys = useQuery(() => api.GET('/api/v1/users/me/passkeys'), []);
  const [dialog, setDialog] = useState<PasskeyDialog>(null);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { run, busy, error, setError } = useAction();
  const supported = passkeysSupported();

  const open = (next: PasskeyDialog) => {
    setError(null);
    setNotice(null);
    if (next && next.kind === 'rename') setName(next.passkey.name);
    setDialog(next);
  };

  const done = (message: string | null) => {
    setDialog(null);
    setNotice(message);
    passkeys.reload();
    refreshLoginMethods();
  };

  async function add(proof: ReauthProof) {
    const { data: start, error: apiError } = await api.POST(
      '/api/v1/auth/passkeys/register/options',
      { body: proof },
    );
    if (apiError || !start) throw apiError;
    let response;
    try {
      response = await createPasskey(start.options);
    } catch (e) {
      if (!(e instanceof PasskeyBrowserError)) throw e;
      throw {
        statusCode: 0,
        code: 'client',
        message: passkeyFailureMessage(m.passkeys.failures, e),
      } satisfies ApiError;
    }
    if (!response) return setDialog(null); // cancelou no navegador
    const { error: saveError } = await api.POST('/api/v1/auth/passkeys/register', {
      body: { challengeToken: start.challengeToken, response },
    });
    if (saveError) throw saveError;
    done(m.passkeys.added);
  }

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (dialog?.kind !== 'rename') return;
    void run(async () => {
      const { error: apiError } = await api.PATCH('/api/v1/users/me/passkeys/{id}', {
        params: { path: { id: dialog.passkey.id } },
        body: { name: name.trim() },
      });
      if (apiError) throw apiError;
      done(null);
    });
  };

  const remove = () =>
    void run(async () => {
      if (dialog?.kind !== 'remove') return;
      const { error: apiError } = await api.DELETE('/api/v1/users/me/passkeys/{id}', {
        params: { path: { id: dialog.passkey.id } },
      });
      if (apiError) throw apiError;
      done(m.passkeys.removed);
    });

  const list = passkeys.data ?? [];

  return (
    <Section title={m.passkeys.title} help={m.passkeys.help}>
      {passkeys.loading && !passkeys.data && <p className="muted">{m.common.loading}</p>}
      <ErrorAlert error={passkeys.error} />
      {list.length > 0 && (
        <ul className="rows">
          {list.map((p) => (
            <li key={p.id}>
              <div className="row-main">
                <span className="row-title">
                  {p.name}
                  {p.backedUp && <Badge>{m.passkeys.synced}</Badge>}
                </span>
                <span className="row-meta">
                  {[
                    f(m.passkeys.createdAt, { date: formatDate(lang, p.createdAt) }),
                    p.lastUsedAt
                      ? f(m.security.lastUsed, { date: formatDateTime(lang, p.lastUsedAt) })
                      : m.passkeys.neverUsed,
                  ].join(' · ')}
                </span>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => open({ kind: 'rename', passkey: p })}>
                  {m.passkeys.rename}
                </button>
                <button type="button" onClick={() => open({ kind: 'remove', passkey: p })}>
                  {m.passkeys.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {passkeys.data && list.length === 0 && (
        <p className="muted">{supported ? m.passkeys.empty : m.passkeys.unsupported}</p>
      )}
      {notice && <SuccessAlert>{notice}</SuccessAlert>}
      {supported && (
        <div className="panel-actions">
          <button type="button" className="primary" onClick={() => open({ kind: 'add' })}>
            {m.passkeys.add}
          </button>
        </div>
      )}

      {dialog?.kind === 'add' && (
        <ReauthDialog
          title={m.passkeys.add}
          text={m.passkeys.addText}
          confirmLabel={m.passkeys.continue}
          onConfirm={add}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <Modal title={m.passkeys.renameTitle} onClose={() => setDialog(null)}>
          <form onSubmit={rename} noValidate>
            <Field
              label={m.common.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              required
              error={fieldError(error, 'name')}
            />
            <FormError error={error} />
            <div className="panel-actions">
              <button type="button" onClick={() => setDialog(null)}>
                {m.common.cancel}
              </button>
              <button
                type="submit"
                className="primary"
                disabled={busy || !name.trim() || name.trim() === dialog.passkey.name}
              >
                {m.common.save}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          title={f(m.passkeys.removeConfirm, { name: dialog.passkey.name })}
          text={m.passkeys.removeText}
          confirmLabel={m.passkeys.remove}
          busy={busy}
          error={error}
          onConfirm={remove}
          onClose={() => setDialog(null)}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- sessões

function SessionsSection() {
  const { m, f, lang } = useI18n();
  const sessions = useQuery(() => api.GET('/api/v1/users/me/sessions'), []);
  const [othersDone, setOthersDone] = useState(false);
  const { run, busy, error } = useAction();

  const revoke = (id: string) =>
    void run(async () => {
      const { error: apiError } = await api.DELETE('/api/v1/users/me/sessions/{id}', {
        params: { path: { id } },
      });
      if (apiError) throw apiError;
      sessions.reload();
    });

  const revokeOthers = () =>
    void run(async () => {
      const { error: apiError } = await api.DELETE('/api/v1/users/me/sessions');
      if (apiError) throw apiError;
      setOthersDone(true);
      sessions.reload();
    });

  const list = sessions.data ?? [];
  const others = list.filter((s) => !s.current);

  return (
    <Section title={m.security.sessions} help={m.security.sessionsHelp}>
      {sessions.loading && !sessions.data && <p className="muted">{m.common.loading}</p>}
      <ErrorAlert error={sessions.error ?? error} />
      <ul className="rows">
        {list.map((s) => (
          <li key={s.id}>
            <div className="row-main">
              <span className="row-title">
                {describeUserAgent(s.userAgent) ?? m.security.unknownDevice}
                {s.current && <Badge tone="accent">{m.security.thisDevice}</Badge>}
              </span>
              <span className="row-meta">
                <span className="mono">{s.ip ?? '—'}</span>
                {' · '}
                {[
                  f(m.security.signedInAt, { date: formatDateTime(lang, s.createdAt) }),
                  s.lastUsedAt &&
                    f(m.security.lastUsed, { date: formatDateTime(lang, s.lastUsedAt) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            {!s.current && (
              <button
                type="button"

                disabled={busy}
                onClick={() => revoke(s.id)}
              >
                {m.security.signOutDevice}
              </button>
            )}
          </li>
        ))}
      </ul>
      {othersDone && <SuccessAlert>{m.security.othersSignedOut}</SuccessAlert>}
      {sessions.data &&
        (others.length > 0 ? (
          <div className="panel-actions">
            <button type="button" className="danger" disabled={busy} onClick={revokeOthers}>
              {m.security.signOutOthers}
            </button>
          </div>
        ) : (
          !othersDone && <p className="muted step-gap">{m.security.noOtherSessions}</p>
        ))}
    </Section>
  );
}

// ---------------------------------------------------------------- formas de login

function MethodsSection({ methods }: { methods: ReturnType<typeof useLoginMethods> }) {
  const { m, f, lang } = useI18n();
  const { run, busy, error } = useAction();

  const unlink = (provider: string) =>
    void run(async () => {
      const { error: apiError } = await api.DELETE('/api/v1/users/me/identities/{provider}', {
        params: { path: { provider: provider as 'google' | 'apple' } },
      });
      if (apiError) throw apiError;
      methods.reload();
    });

  const data = methods.data;

  return (
    <Section title={m.security.methods} help={m.security.linkHelp}>
      <ErrorAlert error={methods.error ?? error} />
      {data && (
        <ul className="rows">
          <li>
            <div className="row-main">
              <span className="row-title">{m.security.methodPassword}</span>
              <span className="row-meta">
                {data.hasPassword ? m.security.methodPasswordOn : m.security.methodPasswordOff}
              </span>
            </div>
          </li>
          {data.identities.map((i) => (
            <li key={i.provider}>
              <div className="row-main">
                <span className="row-title capitalize">{i.provider}</span>
                <span className="row-meta">
                  {[i.email, f(m.security.linkedOn, { date: formatDate(lang, i.createdAt) })]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button
                type="button"

                disabled={busy}
                onClick={() => unlink(i.provider)}
              >
                {m.security.unlink}
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.identities.length === 0 && (
        <p className="muted step-gap">{m.security.noIdentities}</p>
      )}
    </Section>
  );
}
