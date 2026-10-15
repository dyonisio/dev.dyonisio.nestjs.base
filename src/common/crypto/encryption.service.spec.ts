import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

const serviceWith = (config: Record<string, string>) =>
  new EncryptionService({
    get: (k: string) => config[k],
    getOrThrow: (k: string) => config[k],
  } as unknown as ConfigService);

describe('EncryptionService', () => {
  const service = serviceWith({ 'security.encryptionKey': 'chave-de-teste' });

  it('cifra e decifra (ida e volta)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = service.encrypt(secret);

    expect(encrypted).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(encrypted).not.toContain(secret);
    expect(service.decrypt(encrypted)).toBe(secret);
  });

  it('o mesmo texto gera cifras diferentes a cada vez (IV aleatório)', () => {
    expect(service.encrypt('x')).not.toBe(service.encrypt('x'));
  });

  it('dado adulterado é rejeitado (GCM autentica o conteúdo)', () => {
    const [v, iv, tag] = service.encrypt('segredo').split('.');
    const tampered = [v, iv, tag, Buffer.from('outra coisa').toString('base64url')].join('.');
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('com outra chave não decifra', () => {
    const other = serviceWith({ 'security.encryptionKey': 'outra-chave' });
    expect(() => other.decrypt(service.encrypt('segredo'))).toThrow();
  });

  it('formato inválido -> erro claro', () => {
    expect(() => service.decrypt('lixo')).toThrow('Formato de dado cifrado inválido');
  });

  it('sem ENCRYPTION_KEY (dev/testes), usa uma chave derivada do JWT_SECRET', () => {
    const fallback = serviceWith({ 'jwt.secret': 'segredo-jwt' });
    expect(fallback.decrypt(fallback.encrypt('ok'))).toBe('ok');
  });
});
