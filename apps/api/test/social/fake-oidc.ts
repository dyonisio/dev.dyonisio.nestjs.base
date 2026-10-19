import { createLocalJWKSet, exportJWK, generateKeyPair, JWK, KeyLike, SignJWT } from 'jose';

/**
 * Um "provedor OIDC de mentira" para testes: gera um par de chaves RSA, publica a
 * chave pública como JWKS e assina ID tokens iguais aos do Google/Apple.
 * A verificação da API roda de verdade (assinatura, emissor, audiência, validade).
 */
export interface FakeOidc {
  jwks: ReturnType<typeof createLocalJWKSet>;
  sign(
    claims: Record<string, unknown>,
    options?: { expiresIn?: string; key?: KeyLike },
  ): Promise<string>;
  otherKey: KeyLike;
}

export const ISSUERS = {
  google: 'https://accounts.google.com',
  apple: 'https://appleid.apple.com',
} as const;

export async function createFakeOidc(): Promise<FakeOidc> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const { privateKey: otherKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    otherKey,
    sign: (claims, options = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '5m')
        .sign(options.key ?? privateKey),
  };
}
