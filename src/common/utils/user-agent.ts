/**
 * Descrição curta e legível de um User-Agent, para e-mails e "meus dispositivos":
 * "Chrome · Windows", "Safari · iOS", "Okhttp · Android"...
 * Heurística simples (sem dependência): a ordem dos testes importa, porque
 * vários navegadores se anunciam também como os outros (o Edge diz "Chrome" e "Safari").
 */
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/okhttp/i, 'Android app'],
  [/CFNetwork|Darwin/, 'iOS app'],
  [/PostmanRuntime/, 'Postman'],
  [/curl\//, 'curl'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod|iOS/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device';
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  const parts = [browser, system].filter(Boolean);
  return parts.length ? parts.join(' · ') : userAgent.slice(0, 60);
}
