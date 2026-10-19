export const LANGUAGES = ['pt-BR', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

const KEY = 'nb.lang';

function detect(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (LANGUAGES as readonly string[]).includes(saved)) return saved as Language;
  } catch {
    /* sem armazenamento */
  }
  return navigator.language?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

let current: Language = detect();

/** Idioma atual — também vai no header Accept-Language: a API responde os erros nele. */
export const getLanguage = (): Language => current;

export function setLanguage(lang: Language) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* sem armazenamento */
  }
  document.documentElement.lang = lang;
}
