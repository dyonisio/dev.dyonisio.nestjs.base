import { api, type ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18nProvider';
import { useQuery } from '../lib/hooks';
import { Field, fieldError } from './ui';

export interface ReauthValue {
  currentPassword: string;
  code: string;
}

export const emptyReauth: ReauthValue = { currentPassword: '', code: '' };

/** Formas de login da pessoa logada (tem senha? Google/Apple vinculados?). */
export function useLoginMethods() {
  return useQuery(() => api.GET('/api/v1/users/me/identities'), []);
}

/** Corpo da "prova de identidade" no formato da API (só os campos preenchidos). */
export function reauthBody(value: ReauthValue) {
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
}: {
  value: ReauthValue;
  onChange: (value: ReauthValue) => void;
  error: ApiError | null;
  hasPassword: boolean;
  /** false quando a ação nunca pede código (ex.: ativar o 2FA, que ainda está desligado) */
  withCode?: boolean;
}) {
  const { m } = useI18n();
  const { user } = useAuth();
  const needsCode = withCode && !!user?.twoFactorEnabledAt;

  return (
    <fieldset className="reauth">
      <legend>{m.reauth.title}</legend>
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
