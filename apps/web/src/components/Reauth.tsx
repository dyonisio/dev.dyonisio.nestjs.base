import { useState, type FormEvent, type ReactNode } from 'react';
import { type ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useLoginMethods } from '../auth/login-methods';
import { useI18n } from '../i18n/I18nProvider';
import { useAction } from '../lib/hooks';
import { Field, fieldError, FormError, Modal } from './ui';

export interface ReauthValue {
  currentPassword: string;
  code: string;
}

export const emptyReauth: ReauthValue = { currentPassword: '', code: '' };

// Formas de login da pessoa logada: uma busca compartilhada por todas as telas
export { refreshLoginMethods, useLoginMethods } from '../auth/login-methods';

/** A "prova de identidade" no formato da API. */
export type ReauthProof = { currentPassword?: string; code?: string };

/** Corpo da "prova de identidade" no formato da API (só os campos preenchidos). */
export function reauthBody(value: ReauthValue): ReauthProof {
  return {
    ...(value.currentPassword ? { currentPassword: value.currentPassword } : {}),
    ...(value.code.trim() ? { code: value.code.trim() } : {}),
  };
}

/**
 * Campos de "confirme que é você" das ações sensíveis (trocar e-mail, excluir conta, ativar 2FA):
 *  - conta com senha → senha atual
 *  - conta só com Google/Apple → nada (a API exige login recente; se não for, pede para entrar de novo)
 *  - com 2FA ativo → também o código do app
 * Veja docs/AUTH.md → "Confirmar que é você".
 */
export function ReauthFields({
  value,
  onChange,
  error,
  hasPassword,
  withCode = true,
  legend = true,
}: {
  value: ReauthValue;
  onChange: (value: ReauthValue) => void;
  error: ApiError | null;
  hasPassword: boolean;
  /** false quando a ação nunca pede código (ex.: ativar o 2FA, que ainda está desligado) */
  withCode?: boolean;
  /** false dentro de uma janela que já tem o próprio título */
  legend?: boolean;
}) {
  const { m } = useI18n();
  const { user } = useAuth();
  const needsCode = withCode && !!user?.twoFactorEnabledAt;

  return (
    <fieldset className={legend ? 'reauth' : 'reauth bare'}>
      {legend && <legend>{m.reauth.title}</legend>}
      {hasPassword ? (
        <Field
          label={m.reauth.currentPassword}
          type="password"
          autoComplete="current-password"
          value={value.currentPassword}
          onChange={(e) => onChange({ ...value, currentPassword: e.target.value })}
          error={fieldError(error, 'currentPassword')}
          required
        />
      ) : (
        <p className="muted">{m.reauth.recentLogin}</p>
      )}
      {needsCode && (
        <Field
          label={m.reauth.code}
          autoComplete="one-time-code"
          value={value.code}
          onChange={(e) => onChange({ ...value, code: e.target.value })}
          hint={m.reauth.codeHint}
          error={fieldError(error, 'code')}
          required
        />
      )}
    </fieldset>
  );
}

/**
 * Janela "confirme que é você" das ações sensíveis: o painel mostra só o essencial, e a senha
 * (e o código do 2FA) só aparecem na hora de confirmar. `onConfirm` recebe a prova no formato
 * da API; se a API recusar, o erro aparece na própria janela e ela continua aberta.
 */
export function ReauthDialog({
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  text?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (proof: ReauthProof) => Promise<void>;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const { user } = useAuth();
  const methods = useLoginMethods();
  const [value, setValue] = useState(emptyReauth);
  const { run, busy, error } = useAction();
  const hasPassword = methods.data?.hasPassword ?? true;
  const ready =
    (!hasPassword || !!value.currentPassword) && (!user?.twoFactorEnabledAt || !!value.code.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => onConfirm(reauthBody(value)));
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {text && <p className="muted dialog-text">{text}</p>}
        <ReauthFields
          value={value}
          onChange={setValue}
          error={error}
          hasPassword={hasPassword}
          legend={false}
        />
        <FormError error={error} />
        <div className="panel-actions">
          <button type="button" onClick={onClose}>
            {m.common.cancel}
          </button>
          <button
            type="submit"
            className={danger ? 'danger solid' : 'primary'}
            disabled={busy || !ready}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
