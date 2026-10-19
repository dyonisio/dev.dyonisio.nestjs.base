import {
  base32Decode,
  base32Encode,
  currentStep,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  TOTP_PERIOD,
  verifyTotp,
} from './totp';

/** Segredo dos vetores de teste oficiais das RFCs 4226 e 6238 (SHA-1). */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP', () => {
  it.each([
    // RFC 6238, Apêndice B (8 dígitos, SHA-1)
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('vetor oficial RFC 6238: T=%s -> %s', (seconds, expected) => {
    expect(hotp(RFC_SECRET, Math.floor(seconds / TOTP_PERIOD), 8)).toBe(expected);
  });

  it.each([
    // RFC 4226, Apêndice D (HOTP, 6 dígitos)
    [0, '755224'],
    [1, '287082'],
    [9, '520489'],
  ])('vetor oficial RFC 4226: contador %s -> %s', (counter, expected) => {
    expect(hotp(RFC_SECRET, counter)).toBe(expected);
  });

  describe('base32', () => {
    it('vetores da RFC 4648', () => {
      expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
      expect(base32Encode(Buffer.from('f'))).toBe('MY');
      expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    });

    it('ida e volta, ignorando espaços, hífens, padding e minúsculas', () => {
      const secret = generateTotpSecret();
      expect(secret).toMatch(/^[A-Z2-7]{32}$/); // 160 bits
      expect(base32Encode(base32Decode(secret.toLowerCase()))).toBe(secret);
      expect(base32Decode('MZXW 6YTB-OI==').toString()).toBe('foobar');
    });

    it('rejeita caracteres inválidos', () => {
      expect(() => base32Decode('ABC1')).toThrow('Caractere inválido');
    });
  });

  describe('verifyTotp', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_700_000_000_000;
    const codeAt = (offsetSteps: number) => hotp(RFC_SECRET, currentStep(now) + offsetSteps);

    it('aceita o código atual e devolve a janela (para impedir reuso)', () => {
      expect(verifyTotp(secret, codeAt(0), { now })).toBe(currentStep(now));
    });

    it('tolera 1 janela de diferença de relógio para cada lado', () => {
      expect(verifyTotp(secret, codeAt(-1), { now })).toBe(currentStep(now) - 1);
      expect(verifyTotp(secret, codeAt(1), { now })).toBe(currentStep(now) + 1);
    });

    it.each([
      ['código de 2 janelas atrás', () => codeAt(-2)],
      ['formato inválido', () => '12345'],
      ['letras', () => 'abcdef'],
    ])('rejeita %s', (_, code) => {
      expect(verifyTotp(secret, code(), { now })).toBeNull();
    });
  });

  it('gera o link otpauth:// lido pelos apps autenticadores', () => {
    expect(
      otpauthUrl({
        secret: 'ABC',
        account: 'ana@x.com',
        issuer: 'Minha API',
        image: 'https://app.x.com/icon.png',
      }),
    ).toContain('&image=https%3A%2F%2Fapp.x.com%2Ficon.png');
    // só HTTPS: um ícone por http (ou localhost) não seria baixado pelo app
    expect(
      otpauthUrl({ secret: 'ABC', account: 'a@x.com', issuer: 'X', image: 'http://x/icon.png' }),
    ).not.toContain('image=');
    expect(otpauthUrl({ secret: 'ABC', account: 'ana@x.com', issuer: 'Minha API' })).toBe(
      'otpauth://totp/Minha%20API:ana%40x.com?secret=ABC&issuer=Minha%20API&algorithm=SHA1&digits=6&period=30',
    );
  });
});
