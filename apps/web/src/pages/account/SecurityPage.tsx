import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { emptyReauth, reauthBody, ReauthFields, useLoginMethods } from '../../components/Reauth';
import {
  Badge,
  ErrorAlert,
  Field,
  fieldError,
  FormError,
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

  // 1. confirma a identidade e gera o segredo
  const startSetup = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/auth/2fa/setup', {
        body: reauthBody(reauth),
      });
      if (apiError || !data) throw apiError;
      // QR gerado no navegador: o segredo nunca vai para um serviço de terceiros
      const qr = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 });
      go({ name: 'scan', secret: data.secret, qr });
    });
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
          <div className="panel-actions">
            {cancel}
            <button type="submit" className="primary" disabled={busy}>
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
            <button type="submit" className="primary" disabled={busy}>
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
              disabled={busy}
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
