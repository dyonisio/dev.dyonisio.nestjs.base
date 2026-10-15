import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

/**
 * Idiomas suportados. Para adicionar um novo:
 *   1. crie src/i18n/locales/<idioma>.json (copie o en.json e traduza)
 *   2. registre-o aqui — o tipo `typeof en` faz o TS acusar chaves faltando
 */
export const TRANSLATIONS: Record<string, typeof en> = {
  en,
  'pt-BR': ptBR,
};

export const SUPPORTED_LANGUAGES = Object.keys(TRANSLATIONS);

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Todas as chaves de tradução válidas, ex.: "auth.invalidCredentials". */
export type TranslationKey = Leaves<typeof en>;

/** Marca uma string como chave de tradução (checada em tempo de compilação). */
export const i18nKey = (key: TranslationKey): TranslationKey => key;

export type TranslationArgs = Record<string, unknown>;

export function lookup(language: string, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node && typeof node === 'object' ? (node as any)[part] : undefined),
      TRANSLATIONS[language],
    );
  return typeof value === 'string' ? value : undefined;
}

/** Substitui {placeholders}; arrays viram "a, b, c". Placeholders sem valor ficam como estão. */
export function interpolate(template: string, args: TranslationArgs = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = args[name];
    if (value === undefined || value === null) return match;
    if (Array.isArray(value)) return value.join(', ');
    switch (typeof value) {
      case 'string':
        return value;
      case 'number':
      case 'boolean':
      case 'bigint':
        return value.toString();
      default:
        return JSON.stringify(value);
    }
  });
}

/** "pt-br" -> "pt-BR", "pt" -> "pt-BR", "en-US" -> "en". Retorna undefined se não suportado. */
export function matchLanguage(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const wanted = candidate.trim().toLowerCase();
  const base = wanted.split('-')[0];

  return (
    SUPPORTED_LANGUAGES.find((lang) => lang.toLowerCase() === wanted) ??
    SUPPORTED_LANGUAGES.find((lang) => lang.toLowerCase() === base) ??
    SUPPORTED_LANGUAGES.find((lang) => lang.toLowerCase().split('-')[0] === base)
  );
}

/** Lê o header Accept-Language respeitando os pesos: "fr, pt-BR;q=0.8" -> ["fr", "pt-BR"]. */
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter(({ tag, q }) => tag && tag !== '*' && q > 0)
    .sort((a, b) => b.q - a.q)
    .map(({ tag }) => tag);
}
