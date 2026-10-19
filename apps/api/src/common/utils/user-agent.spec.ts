import { describeUserAgent } from './user-agent';

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
      'Chrome · Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
      'Edge · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari · iOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox · Linux'],
    ['okhttp/4.12.0', 'Android app'],
    ['curl/8.4.0', 'curl'],
  ])('%s -> %s', (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });

  it('sem user agent ou desconhecido', () => {
    expect(describeUserAgent(null)).toBe('Unknown device');
    expect(describeUserAgent('MeuApp/1.0')).toBe('MeuApp/1.0');
  });
});
