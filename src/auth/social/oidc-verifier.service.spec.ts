import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { createFakeOidc, FakeOidc, ISSUERS } from '../../../test/social/fake-oidc';
import { JwksResolver, OidcVerifier } from './oidc-verifier.service';

describe('OidcVerifier', () => {
  let oidc: FakeOidc;
  let verifier: OidcVerifier;

  const social = {
    google: { clientIds: ['web.apps.googleusercontent.com', 'ios.apps.googleusercontent.com'] },
    apple: { clientIds: [] as string[] },
  };
  const google = (
    claims: Record<string, unknown> = {},
    options?: Parameters<FakeOidc['sign']>[1],
  ) =>
    oidc.sign(
      {
        iss: ISSUERS.google,
        aud: 'web.apps.googleusercontent.com',
        sub: 'google-123',
        email: 'Ana@Gmail.com',
        email_verified: true,
        name: 'Ana',
        ...claims,
      },
      options,
    );

  beforeAll(async () => {
    oidc = await createFakeOidc();
    const jwks = { resolve: () => oidc.jwks } as unknown as JwksResolver;
    verifier = new OidcVerifier({ get: () => social } as unknown as ConfigService, jwks);
  });

  it('só os provedores com client ID configurado ficam habilitados', () => {
    expect(verifier.enabledProviders()).toEqual(['google']);
  });

  it('token válido -> perfil normalizado (e-mail em minúsculas)', async () => {
    await expect(verifier.verify('google', await google())).resolves.toEqual({
      provider: 'google',
      subject: 'google-123',
      email: 'ana@gmail.com',
      emailVerified: true,
      name: 'Ana',
    });
  });

  it('aceita qualquer um dos client IDs do app (web, iOS, Android...)', async () => {
    const token = await google({ aud: 'ios.apps.googleusercontent.com' });
    await expect(verifier.verify('google', token)).resolves.toMatchObject({
      subject: 'google-123',
    });
  });

  it.each([
    [
      'emitido para OUTRO app (audiência)',
      () => google({ aud: 'outro-app.apps.googleusercontent.com' }),
    ],
    ['emitido por outro emissor', () => google({ iss: 'https://evil.example.com' })],
    ['expirado', () => google({}, { expiresIn: '-10m' })],
    ['assinado com outra chave (falsificado)', () => google({}, { key: oidc.otherKey })],
    ['sem "sub"', () => google({ sub: undefined })],
    ['que nem é um JWT', () => Promise.resolve('lixo')],
  ])('rejeita token %s com 401', async (_, makeToken) => {
    await expect(verifier.verify('google', await makeToken())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('provedor sem client ID configurado -> 400', async () => {
    await expect(verifier.verify('apple', await google())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('nonce (proteção contra replay)', () => {
    it('aceita o nonce puro (Google) e o SHA-256 dele (Apple)', async () => {
      const hashed = createHash('sha256').update('n-1').digest('hex');
      await expect(
        verifier.verify('google', await google({ nonce: 'n-1' }), 'n-1'),
      ).resolves.toBeDefined();
      await expect(
        verifier.verify('google', await google({ nonce: hashed }), 'n-1'),
      ).resolves.toBeDefined();
    });

    it('rejeita nonce diferente ou ausente quando o app enviou um', async () => {
      await expect(
        verifier.verify('google', await google({ nonce: 'outro' }), 'n-1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(verifier.verify('google', await google(), 'n-1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  it('email_verified "true" em texto (formato da Apple) conta como verificado; ausente, não', async () => {
    expect(
      (await verifier.verify('google', await google({ email_verified: 'true' }))).emailVerified,
    ).toBe(true);
    const profile = await verifier.verify(
      'google',
      await google({ email_verified: undefined, email: undefined, name: undefined }),
    );
    expect(profile).toMatchObject({ emailVerified: false, email: undefined, name: undefined });
  });
});
