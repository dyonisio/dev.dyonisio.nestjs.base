import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * TOTP (RFC 6238) — os códigos de 6 dígitos dos apps autenticadores
 * (Google Authenticator, Authy, 1Password...). Padrão: HMAC-SHA1, 30 s, 6 dígitos.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Caractere inválido em base32: "${char}"`);
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Segredo novo (160 bits, o recomendado pela RFC 4226), em base32 — o formato dos apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Janela de tempo atual (conta de 30 em 30 segundos desde 1970). */
export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD);
}

/** HOTP (RFC 4226): o código de um "contador" — no TOTP, o contador é a janela de tempo. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Confere um código de 6 dígitos aceitando ±1 janela (relógio do celular um pouco
 * adiantado/atrasado). Retorna a janela que bateu — usada para impedir que o mesmo
 * código seja reaproveitado — ou null.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { now?: number; window?: number } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const step = currentStep(options.now);
  const window = options.window ?? 1;

  for (let s = step - window; s <= step + window; s++) {
    if (timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(code))) return s;
  }
  return null;
}

/** Link lido pelos apps autenticadores (o frontend o transforma em QR code). */
export function otpauthUrl(params: { secret: string; account: string; issuer: string }): string {
  const issuer = encodeURIComponent(params.issuer);
  const label = `${issuer}:${encodeURIComponent(params.account)}`;
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
}
