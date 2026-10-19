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
  Section,
  SuccessAlert,
} from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import { describeUserAgent, formatDate, formatDateTime } from '../../lib/format';
import { useAction, useQuery } from '../../lib/hooks';

/** /account/security — 2FA, dispositivos conectados e formas de login. Destino dos e-mails de alerta. */
export function SecurityPage() {
  const { m } = useI18n();
  const methods = useLoginMethods();

  return (
    <>
      <h1>{m.security.title}</h1>
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
    <button type="button" className="secondary" onClick={() => go({ name: 'idle' })}>
      {m.common.cancel}
    </button>
  );

  return (
    <Section title={m.security.twoFactor} help={m.security.twoFactorHelp}>
      <p>
        {enabled ? (
          <Badge tone="success">
            {f(m.security.enabledSince, { date: formatDate(lang, user.twoFactorEnabledAt) })}
          </Badge>
        ) : (
          <Badge tone="warning">{m.security.disabled}</Badge>
        )}
      </p>

      {step.name === 'idle' &&
        (enabled ? (
          <div className="row">
            <button type="button" className="secondary" onClick={() => go({ name: 'regenerate' })}>
              {m.security.regenerate}
            </button>
            <button type="button" className="danger" onClick={() => go({ name: 'disable' })}>
              {m.security.disable}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => go({ name: 'reauth' })}>
            {m.security.enable}
          </button>
        ))}

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
          <div className="actions">
            {cancel}
            <button type="submit" disabled={busy}>
              {m.common.submit}
            </button>
          </div>
        </form>
      )}

      {step.name === 'scan' && (
        <form onSubmit={activate} noValidate>
          <p>{m.security.scan}</p>
          <img src={step.qr} alt="QR code" className="qr" width={200} height={200} />
          <p className="muted">{m.security.manual}</p>
          <code className="secret">{step.secret}</code>
          <p>{m.security.enterCode}</p>
          {codeField}
          <FormError error={error} />
          <div className="actions">
            {cancel}
            <button type="submit" disabled={busy}>
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
          <div className="actions">
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
      <div className="row">
        <button type="button" className="secondary" onClick={copy}>
          {copied ? m.security.copied : m.security.copy}
        </button>
        <button type="button" className="secondary" onClick={download}>
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
      <ul className="list">
        {list.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{describeUserAgent(s.userAgent) ?? m.security.unknownDevice}</strong>{' '}
              {s.current && <Badge tone="success">{m.security.thisDevice}</Badge>}
              <div className="muted small">
                {[
                  s.ip,
                  f(m.security.signedInAt, { date: formatDateTime(lang, s.createdAt) }),
                  s.lastUsedAt &&
                    f(m.security.lastUsed, { date: formatDateTime(lang, s.lastUsedAt) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {!s.current && (
              <button
                type="button"
                className="secondary"
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
          <button type="button" className="danger" disabled={busy} onClick={revokeOthers}>
            {m.security.signOutOthers}
          </button>
        ) : (
          !othersDone && <p className="muted">{m.security.noOtherSessions}</p>
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
        <ul className="list">
          <li>
            <strong>{m.security.methodPassword}</strong>
            <Badge tone={data.hasPassword ? 'success' : 'neutral'}>
              {data.hasPassword ? m.security.methodPasswordOn : m.security.methodPasswordOff}
            </Badge>
          </li>
          {data.identities.map((i) => (
            <li key={i.provider}>
              <div>
                <strong className="capitalize">{i.provider}</strong>
                <div className="muted small">
                  {[i.email, f(m.security.linkedOn, { date: formatDate(lang, i.createdAt) })]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => unlink(i.provider)}
              >
                {m.security.unlink}
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.identities.length === 0 && <p className="muted">{m.security.noIdentities}</p>}
    </Section>
  );
}
