import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { getLanguage, setLanguage, type Language } from './language';
import { MESSAGES, type Messages } from './messages';

interface I18nValue {
  lang: Language;
  m: Messages;
  setLang: (lang: Language) => void;
  /** Substitui {nome} pelos valores: f(m.home.hello, { name: 'Ana' }) */
  f: (text: string, args: Record<string, string>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(getLanguage());

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      m: MESSAGES[lang],
      setLang: (next) => {
        setLanguage(next);
        setLangState(next);
      },
      f: (text, args) => text.replace(/\{(\w+)\}/g, (_, k: string) => args[k] ?? `{${k}}`),
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n precisa estar dentro de <I18nProvider>');
  return value;
}
