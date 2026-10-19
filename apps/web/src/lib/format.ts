import type { Language } from '../i18n/language';

/** Data e hora no formato do idioma (ex.: 19/10/2026 14:05). Vazio para null. */
export function formatDateTime(lang: Language, value: string | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function formatDate(lang: Language, value: string | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(value));
}

export function formatTime(lang: Language, value: string | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(lang, { timeStyle: 'short' }).format(new Date(value));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * Resumo legível do user agent ("Chrome · Windows"). Aproximado de propósito: serve para a
 * pessoa reconhecer o dispositivo na lista de sessões, não para identificar nada com precisão.
 */
export function describeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser =
    [
      [/Edg\//, 'Edge'],
      [/OPR\/|Opera/, 'Opera'],
      [/Firefox\//, 'Firefox'],
      [/Chrome\//, 'Chrome'],
      [/Safari\//, 'Safari'],
    ].find(([re]) => (re as RegExp).test(ua))?.[1] ?? null;
  const os =
    [
      [/iPhone|iPad|iOS/, 'iOS'],
      [/Android/, 'Android'],
      [/Windows/, 'Windows'],
      [/Mac OS X|Macintosh/, 'macOS'],
      [/Linux/, 'Linux'],
    ].find(([re]) => (re as RegExp).test(ua))?.[1] ?? null;
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(' · ') : ua.slice(0, 60);
}

/** Salva um objeto como arquivo .json no computador da pessoa. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
