import {
  interpolate,
  lookup,
  matchLanguage,
  parseAcceptLanguage,
  SUPPORTED_LANGUAGES,
  TRANSLATIONS,
} from './translations';

const flatten = (node: object, prefix = ''): Record<string, string> =>
  Object.entries(node).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value as object, path) };
  }, {});

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('translations', () => {
  const reference = flatten(TRANSLATIONS.en);

  it.each(SUPPORTED_LANGUAGES)('"%s" tem exatamente as mesmas chaves do en.json', (lang) => {
    expect(Object.keys(flatten(TRANSLATIONS[lang])).sort()).toEqual(Object.keys(reference).sort());
  });

  it.each(SUPPORTED_LANGUAGES)('"%s" usa os mesmos {placeholders} do en.json', (lang) => {
    const translated = flatten(TRANSLATIONS[lang]);
    for (const [key, text] of Object.entries(reference)) {
      expect({ key, placeholders: placeholders(translated[key]) }).toEqual({
        key,
        placeholders: placeholders(text),
      });
    }
  });

  it('lookup encontra chaves aninhadas e retorna undefined para inexistentes', () => {
    expect(lookup('pt-BR', 'auth.invalidCredentials')).toBe('E-mail ou senha inválidos');
    expect(lookup('en', 'errors.http.404')).toBe('Resource not found');
    expect(lookup('en', 'auth.naoExiste')).toBeUndefined();
    expect(lookup('en', 'auth')).toBeUndefined(); // nó, não folha
  });

  it('interpolate substitui placeholders, junta arrays e preserva os ausentes', () => {
    expect(interpolate('{field} min {min}', { field: 'senha', min: 8 })).toBe('senha min 8');
    expect(interpolate('one of: {values}', { values: ['a', 'b'] })).toBe('one of: a, b');
    expect(interpolate('{field} x {missing}', { field: 'f' })).toBe('f x {missing}');
  });

  it.each([
    ['pt-BR', 'pt-BR'],
    ['pt-br', 'pt-BR'],
    ['pt', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['fr', undefined],
    [undefined, undefined],
  ])('matchLanguage(%s) -> %s', (input, expected) => {
    expect(matchLanguage(input)).toBe(expected);
  });

  it('parseAcceptLanguage ordena pelos pesos e ignora * e q=0', () => {
    expect(parseAcceptLanguage('fr;q=0.5, pt-BR, en;q=0.8, *;q=0.1, de;q=0')).toEqual([
      'pt-BR',
      'en',
      'fr',
    ]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});
