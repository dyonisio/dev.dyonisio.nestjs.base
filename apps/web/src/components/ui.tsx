import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { User } from '../auth/session';
import { useI18n } from '../i18n/I18nProvider';
import { LANGUAGES, type Language } from '../i18n/language';
import { getTheme, setTheme, THEMES, type Theme } from '../lib/theme';
import { ProductMark } from './Icon';

/** Página de formulário centralizada (login, cadastro, senha...). */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { m } = useI18n();
  return (
    <main className="auth">
      <div className="auth-brand">
        <ProductMark size={28} />
        {m.appName}
      </div>
      <div className="auth-card">
        <h1>{title}</h1>
        {children}
      </div>
      <LegalLinks />
      <Preferences />
    </main>
  );
}

/** "Privacidade · Termos", no rodapé das telas públicas. */
export function LegalLinks() {
  const { m } = useI18n();
  return (
    <nav className="legal-links" aria-label={m.legal.nav}>
      <Link to="/privacy">{m.legal.privacy}</Link>
      <span aria-hidden="true">·</span>
      <Link to="/terms">{m.legal.terms}</Link>
    </nav>
  );
}

/** Idioma e tema, lado a lado (barra superior e telas públicas). */
export function Preferences() {
  return (
    <div className="prefs">
      <ThemeSwitch />
      <LanguageSwitch />
    </div>
  );
}

export function ThemeSwitch() {
  const { m } = useI18n();
  const [theme, setLocal] = useState<Theme>(getTheme);
  return (
    <div className="lang">
      <select
        aria-label={m.theme.label}
        value={theme}
        onChange={(e) => {
          const next = e.target.value as Theme;
          setTheme(next);
          setLocal(next);
        }}
      >
        {THEMES.map((t) => (
          <option key={t} value={t}>
            {m.theme[t]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Título da tela (o h1), uma linha opcional sobre os dados e as ações reais à direita. */
export function PageHeader({
  title,
  subtitle,
  actions,
  lead,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Algo antes do título (ex.: o avatar no detalhe do usuário) */
  lead?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="person">
        {lead}
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

/**
 * Uma linha de configuração: à esquerda o nome e a explicação, à direita o painel com os campos.
 * `danger` para a zona destrutiva (sempre a última da tela).
 */
export function Section({
  title,
  help,
  children,
  danger,
}: {
  title: string;
  help?: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  const id = useId();
  return (
    <section className={danger ? 'setting setting-danger' : 'setting'} aria-labelledby={id}>
      <div className="setting-label">
        <h2 id={id}>{title}</h2>
        {help && <p>{help}</p>}
      </div>
      <div className="setting-panel">{children}</div>
    </section>
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

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function SelectField({ label, hint, error, options, ...select }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} aria-invalid={!!error} aria-describedby={`${id}-help`} {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {(error || hint) && (
        <small id={`${id}-help`} className={error ? 'error' : 'hint'}>
          {error ?? hint}
        </small>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  ...input
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...input} />
      <span>{label}</span>
    </label>
  );
}

/** Opções de idioma para um <SelectField>. */
export function useLanguageOptions(): { value: Language; label: string }[] {
  return LANGUAGES.map((l) => ({ value: l, label: l === 'pt-BR' ? 'Português' : 'English' }));
}

/** Mensagem de erro geral. Os textos vêm traduzidos da API; erro de rede tem texto próprio. */
export function ErrorAlert({ error }: { error: ApiError | null }) {
  const { m } = useI18n();
  if (!error) return null;
  // Conta sem senha com login antigo: a única saída é entrar de novo
  if (error.code === 'account.reauthRequired') return <ReauthRequiredAlert />;
  return (
    <p className="alert alert-error" role="alert">
      {error.code === 'network' ? m.common.networkError : error.message}
    </p>
  );
}

function ReauthRequiredAlert() {
  const { m } = useI18n();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <p className="alert alert-error" role="alert">
      {m.reauth.reauthRequired}{' '}
      <button
        type="button"
        className="link"
        onClick={() => void logout().then(() => navigate('/login', { state: { from: pathname } }))}
      >
        {m.reauth.signInAgain}
      </button>
    </p>
  );
}

/** Erro geral só quando não é erro de campo (esses aparecem embaixo de cada campo). */
export function FormError({ error }: { error: ApiError | null }) {
  return <ErrorAlert error={error?.errors ? null : error} />;
}

export function SuccessAlert({ children }: { children: ReactNode }) {
  return (
    <p className="alert alert-success" role="status">
      {children}
    </p>
  );
}

/** Conteúdo de um botão que pode estar esperando a API: troca o texto e mostra o giro. */
export function BusyLabel({
  busy,
  busyText,
  children,
}: {
  busy: boolean;
  busyText: string;
  children: ReactNode;
}) {
  if (!busy) return <>{children}</>;
  return (
    <>
      <span className="spinner" aria-hidden="true" />
      {busyText}
    </>
  );
}

/** Aviso de "esperando" fora de um botão (ex.: depois do popup do Google). */
export function BusyNote({ children }: { children: ReactNode }) {
  return (
    <p className="busy-note" role="status">
      <span className="spinner" aria-hidden="true" />
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
  const options = useLanguageOptions();
  return (
    <div className="lang">
      <select
        aria-label={m.language}
        value={lang}
        onChange={(e) => setLang(e.target.value as Language)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Matiz estável por pessoa (a mesma pessoa tem sempre a mesma cor, em tom pálido). */
function hueOf(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Foto do usuário, ou as iniciais num tom pálido próprio de cada pessoa. */
export function Avatar({
  user,
  size = 40,
}: {
  user: Pick<User, 'name' | 'avatarUrl'>;
  size?: number;
}) {
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.38),
    '--h': hueOf(user.name),
  } as React.CSSProperties;
  if (user.avatarUrl) return <img src={user.avatarUrl} alt="" className="avatar" style={style} />;
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span className="avatar avatar-initials" style={style} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  return <span className={tone === 'neutral' ? 'pill' : `pill pill-${tone}`}>{children}</span>;
}

/** Janela sobre a página (Esc ou clique fora fecham). */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Pergunta "tem certeza?" antes de uma ação destrutiva. */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  text?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: ApiError | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { m } = useI18n();
  return (
    <Modal title={title} onClose={onClose}>
      {text && <p className="muted">{text}</p>}
      <ErrorAlert error={error ?? null} />
      <div className="panel-actions">
        <button type="button" onClick={onClose}>
          {m.common.cancel}
        </button>
        <button type="button" className="danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Paginação: o intervalo à esquerda ("Página 1 de 3 · 42 usuários"), anterior/próxima à direita. */
export function Pager({
  page,
  totalPages,
  label,
  onPage,
}: {
  page: number;
  totalPages: number;
  label: string;
  onPage: (page: number) => void;
}) {
  const { m } = useI18n();
  return (
    <nav className="pager" aria-label={label}>
      <span className="muted num">{label}</span>
      <div>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {m.users.previous}
        </button>
        <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          {m.users.next}
        </button>
      </div>
    </nav>
  );
}
