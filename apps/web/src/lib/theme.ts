/**
 * Tema da interface: claro (padrão), escuro, ou o do sistema. Fica salvo no navegador.
 * Vira o atributo <html data-theme="light|dark">, que o styles.css usa; "system" tira o
 * atributo e deixa o CSS seguir o prefers-color-scheme.
 */
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

const KEY = 'nb.theme';

function detect(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (THEMES as readonly string[]).includes(saved)) return saved as Theme;
  } catch {
    /* sem armazenamento */
  }
  return 'light';
}

let current: Theme = detect();

export const getTheme = (): Theme => current;

/** Aplica o tema atual na página. Chame antes do primeiro render (main.tsx), sem piscar. */
export function applyTheme() {
  const root = document.documentElement;
  if (current === 'system') delete root.dataset.theme;
  else root.dataset.theme = current;
}

export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* sem armazenamento: vale até fechar a aba */
  }
  applyTheme();
}
