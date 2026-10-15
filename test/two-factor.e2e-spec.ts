import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { base32Decode, currentStep, hotp } from '../src/auth/two-factor/totp';
import { Role } from '../src/common/enums/role.enum';
import { UsersService } from '../src/users/users.service';

describe('2FA (e2e)', () => {
  let app: INestApplication<App>;
  let token: string; // sessão da Ana antes do 2FA
  let secret: string;
  let recoveryCodes: string[];
  let base: number; // janela de 30 s no início dos testes

  const http = () => request(app.getHttpServer());
  const login = (email = 'ana@test.com') =>
    http().post('/api/v1/auth/login').send({ email, password: 'Senha123' });
  const auth = (req: request.Test, t = token) => req.set('Authorization', `Bearer ${t}`);
  /** Código que o app autenticador mostraria na janela base+offset. */
  const code = (offset: number) => hotp(base32Decode(secret), base + offset);
  const verify = (twoFactorToken: string, c: string) =>
    http()
      .post('/api/v1/auth/2fa/verify')
      .set('Accept-Language', 'pt-BR')
      .send({ twoFactorToken, code: c });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();

    const users = app.get(UsersService);
    for (const [email, role] of [
      ['ana@test.com', Role.USER],
      ['bia@test.com', Role.USER],
      ['admin@test.com', Role.ADMIN],
    ] as const) {
      await users.create({ name: 'X', email, password: 'Senha123', role }, { emailVerified: true });
    }
    token = (await login().expect(200)).body.accessToken;
  });

  afterAll(() => app.close());

  describe('ativação', () => {
    it('exige a senha atual: um token roubado não consegue ativar o 2FA e trancar o dono', async () => {
      const res = await auth(http().post('/api/v1/auth/2fa/setup'))
        .set('Accept-Language', 'pt-BR')
        .expect(400);
      expect(res.body.code).toBe('account.passwordRequired');
      await auth(http().post('/api/v1/auth/2fa/setup'))
        .send({ currentPassword: 'Errada123' })
        .expect(400);
    });

    it('setup devolve o segredo e o link otpauth:// (para o QR code)', async () => {
      const res = await auth(http().post('/api/v1/auth/2fa/setup'))
        .send({ currentPassword: 'Senha123' })
        .expect(201);

      expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(res.body.otpauthUrl).toMatch(
        /^otpauth:\/\/totp\/NestJS%20Base%20API:ana%40test\.com\?secret=[A-Z2-7]{32}&issuer=/,
      );
      secret = res.body.secret;
      base = currentStep();
    });

    it('enquanto não confirma, o login continua normal (2FA ainda inativo)', async () => {
      expect((await login().expect(200)).body.accessToken).toEqual(expect.any(String));
    });

    it('confirmar com código errado -> 400 traduzido', async () => {
      const res = await auth(http().post('/api/v1/auth/2fa/enable'))
        .set('Accept-Language', 'pt-BR')
        .send({ code: '000000' })
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'twoFactor.invalidCode',
        message: 'Código inválido ou já utilizado',
      });
    });

    it('confirmar com o código do app ativa e devolve 10 códigos de recuperação', async () => {
      const res = await auth(http().post('/api/v1/auth/2fa/enable'))
        .send({ code: code(0) })
        .expect(200);

      recoveryCodes = res.body.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      expect(recoveryCodes.every((c) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(c))).toBe(true);
    });

    it('o perfil mostra o 2FA ativo e NUNCA expõe o segredo nem os códigos', async () => {
      const res = await auth(http().get('/api/v1/users/me')).expect(200);

      expect(res.body.twoFactorEnabledAt).toEqual(expect.any(String));
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(secret);
      expect(res.body).not.toHaveProperty('twoFactorSecret');
      expect(res.body).not.toHaveProperty('twoFactorRecoveryCodes');
    });

    it('setup de novo com 2FA ativo -> 400', () =>
      auth(http().post('/api/v1/auth/2fa/setup'))
        .send({ currentPassword: 'Senha123' })
        .expect(400));

    it('gerar novos códigos de recuperação (exige código do app); os antigos deixam de valer', async () => {
      const old = recoveryCodes;
      const res = await auth(http().post('/api/v1/auth/2fa/recovery-codes'))
        .send({ code: code(1) })
        .expect(200);

      recoveryCodes = res.body.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      const challenge = (await login().expect(200)).body.twoFactorToken;
      await verify(challenge, old[0]).expect(400);
    });
  });

  describe('login em duas etapas', () => {
    it('senha certa NÃO devolve tokens: devolve o desafio do segundo passo', async () => {
      const res = await login().expect(200);

      expect(res.body).toEqual({
        twoFactorRequired: true,
        twoFactorToken: expect.any(String),
        expiresIn: 300,
      });
      expect(res.body).not.toHaveProperty('accessToken');
    });

    it('código de recuperação funciona uma única vez', async () => {
      const first = (await login().expect(200)).body.twoFactorToken;
      const res = await verify(first, recoveryCodes[0].toLowerCase()).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));

      const second = (await login().expect(200)).body.twoFactorToken;
      await verify(second, recoveryCodes[0]).expect(400);
    });

    it('um código do app que já foi aceito não é aceito de novo (anti-replay)', async () => {
      // code(1) foi usado para gerar os códigos de recuperação
      const challenge = (await login().expect(200)).body.twoFactorToken;
      const res = await verify(challenge, code(1)).expect(400);
      expect(res.body.code).toBe('twoFactor.invalidCode');
    });

    it('token de desafio inválido -> 401', async () => {
      const res = await verify('nao-e-um-token', '123456').expect(401);
      expect(res.body.code).toBe('twoFactor.invalidChallenge');
    });

    it('o access token NÃO serve como token de desafio (segredos diferentes)', () =>
      verify(token, recoveryCodes[1]).expect(401));

    it('formato de código inválido -> 400 de validação', async () => {
      const res = await verify('x', '12ab').expect(400);
      expect(res.body.errors[0]).toMatchObject({ field: 'code', code: 'validation.twoFactorCode' });
    });
  });

  it('desativar exige um código válido; depois o login volta a devolver tokens direto', async () => {
    await auth(http().post('/api/v1/auth/2fa/disable')).send({ code: '999999' }).expect(400);
    await auth(http().post('/api/v1/auth/2fa/disable'))
      .send({ code: recoveryCodes[1] })
      .expect(204);

    expect((await login().expect(200)).body.accessToken).toEqual(expect.any(String));
  });

  it('limite de tentativas POR USUÁRIO (contra força bruta de vários IPs) -> 429', async () => {
    const bia = (await login('bia@test.com').expect(200)).body.accessToken;
    const s = (
      await auth(http().post('/api/v1/auth/2fa/setup'), bia)
        .send({ currentPassword: 'Senha123' })
        .expect(201)
    ).body.secret;
    await auth(http().post('/api/v1/auth/2fa/enable'), bia)
      .send({ code: hotp(base32Decode(s), currentStep()) })
      .expect(200);

    const challenge = (await login('bia@test.com').expect(200)).body.twoFactorToken;
    // a ativação já consumiu 1 tentativa; o limite é 10 por 15 min
    for (let i = 0; i < 9; i++) await verify(challenge, '000000').expect(400);

    const res = await verify(challenge, '000000').expect(429);
    expect(res.body.code).toBe('errors.tooManyRequests');
  });

  it('admin pode resetar o 2FA de quem perdeu o celular e os códigos', async () => {
    const admin = (await login('admin@test.com').expect(200)).body.accessToken;
    const biaId = (await auth(http().get('/api/v1/users?search=bia'), admin).expect(200)).body
      .data[0].id as string;

    await auth(http().delete(`/api/v1/users/${biaId}/two-factor`), admin).expect(204);

    expect((await login('bia@test.com').expect(200)).body.accessToken).toEqual(expect.any(String));
  });

  it('usuário comum não pode resetar o 2FA de outro (403)', async () => {
    const anaId = (await auth(http().get('/api/v1/users/me')).expect(200)).body.id as string;
    await auth(http().delete(`/api/v1/users/${anaId}/two-factor`)).expect(403);
  });
});
