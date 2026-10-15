import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Cifra dados sensíveis guardados no banco (ex.: segredos de 2FA) com AES-256-GCM.
 * Se o banco vazar, sem a ENCRYPTION_KEY os segredos são inúteis.
 *
 * Formato: "v1.<iv>.<tag>.<dados>" (base64url). O "v1" permite trocar o algoritmo no futuro.
 * ATENÇÃO: trocar a ENCRYPTION_KEY invalida tudo que foi cifrado com a anterior.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    // Fora de produção, se ENCRYPTION_KEY não existir, deriva do JWT_SECRET (só para dev/testes)
    const material =
      config.get<string>('security.encryptionKey') || config.getOrThrow<string>('jwt.secret');
    this.key = createHash('sha256').update(material).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !data)
      throw new Error('Formato de dado cifrado inválido');

    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
