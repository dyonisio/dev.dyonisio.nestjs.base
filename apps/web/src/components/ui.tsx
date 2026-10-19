import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';
import { LANGUAGES } from '../i18n/language';

/** Página de formulário centralizada (login, cadastro, senha...). */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
      <LanguageSwitch />
    </main>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  /** Erro deste campo vindo da validação da API (errors[].field) */
  error?: string;
}

export function Field({ label, hint, error, ...input }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={`${id}-help`} {...input} />
      {(error || hint) && (
        <small id={`${id}-help`} className={error ? 'error' : 'hint'}>
          {error ?? hint}
        </small>
      )}
    </div>
  );
}

/** Mensagem de erro geral. Os textos vêm traduzidos da API; erro de rede tem texto próprio. */
export function ErrorAlert({ error }: { error: ApiError | null }) {
  const { m } = useI18n();
  if (!error) return null;
  return (
    <p className="alert alert-error" role="alert">
      {error.code === 'network' ? m.common.networkError : error.message}
    </p>
  );
}

export function SuccessAlert({ children }: { children: ReactNode }) {
  return (
    <p className="alert alert-success" role="status">
      {children}
    </p>
  );
}

/** Erro de um campo específico (validação da API). */
export const fieldError = (error: ApiError | null, field: string) =>
  error?.errors?.find((e) => e.field === field)?.message;

export function BackToLogin() {
  const { m } = useI18n();
  return (
    <p className="links">
      <Link to="/login">{m.common.backToLogin}</Link>
    </p>
  );
}

export function LanguageSwitch() {
  const { lang, setLang, m } = useI18n();
  return (
    <label className="lang">
      <span>{m.language}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as (typeof LANGUAGES)[number])}>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {l === 'pt-BR' ? 'Português' : 'English'}
          </option>
        ))}
      </select>
    </label>
  );
}
