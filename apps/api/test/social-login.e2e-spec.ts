import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { createFakeOidc, FakeOidc, ISSUERS } from './social/fake-oidc';

// Provedores habilitados só neste arquivo (os módulos são importados depois, no beforeAll)
Object.assign(process.env, {
  GOOGLE_CLIENT_IDS: 'web.apps.googleusercontent.com',
  APPLE_CLIENT_IDS: 'com.example.app',
});

describe('Login social (e2e)', () => {
  let app: INestApplication<App>;
  let oidc: FakeOidc;
  let sendWelcome: jest.SpyInstance;
  let mail: import('../src/mail/mail.service').MailService;
  let users: import('../src/users/users.service').UsersService;

  const http = () => request(app.getHttpServer());
  const googleToken = (claims: Record<string, unknown>) =>
    oidc.sign({
      iss: ISSUERS.google,
      aud: 'web.apps.googleusercontent.com',
      email_verified: true,
      ...claims,
    });
  const appleToken = (claims: Record<string, unknown>) =>
    oidc.sign({ iss: ISSUERS.apple, aud: 'com.example.app', email_verified: 'true', ...claims });
  const social = (provider: string, body: object) =>
    http().post(`/api/v1/auth/social/${provider}`).set('Accept-Language', 'pt-BR').send(body);
  const as = (token: string, req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    oidc = await createFakeOidc();
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const { JwksResolver } = await import('../src/auth/social/oidc-verifier.service');
    const { MailService } = await import('../src/mail/mail.service');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Chaves do provedor de mentira no lugar das do Google/Apple (sem internet)
      .overrideProvider(JwksResolver)
      .useValue({ resolve: () => oidc.jwks })
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
    const { UsersService } = await import('../src/users/users.service');
    mail = app.get(MailService);
    users = app.get(UsersService);
    sendWelcome = jest.spyOn(mail, 'sendWelcome');
  });

  afterAll(() => app.close());

  describe('primeiro acesso com e-mail novo', () => {
    let token: string;
    let userId: string;

    it('cria a conta já verificada, sem senha, e envia boas-vindas', async () => {
      const res = await social('google', {
        idToken: await googleToken({ sub: 'g-ana', email: 'Ana@Gmail.com', name: 'Ana Google' }),
      }).expect(200);

      expect(res.body.user).toMatchObject({
        email: 'ana@gmail.com',
        name: 'Ana Google',
        role: 'user',
        locale: 'pt-BR',
        emailVerifiedAt: expect.any(String),
      });
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(sendWelcome).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@gmail.com' }));
      token = res.body.accessToken;
      userId = res.body.user.id;
    });

    it('próximo login com o mesmo Google entra na MESMA conta', async () => {
      const res = await social('google', {
        idToken: await googleToken({ sub: 'g-ana', email: 'ana@gmail.com' }),
      }).expect(200);
      expect(res.body.user.id).toBe(userId);
    });

    it('a conta não tem senha: login por senha falha e trocar a senha orienta a usar "esqueci a senha"', async () => {
      const methods = await as(token, http().get('/api/v1/users/me/identities')).expect(200);
      expect(methods.body).toEqual({
        hasPassword: false,
        identities: [{ provider: 'google', email: 'ana@gmail.com', createdAt: expect.any(String) }],
        passkeys: 0,
      });

      const res = await as(token, http().post('/api/v1/auth/password/change'))
        .set('Accept-Language', 'pt-BR')
        .send({ currentPassword: 'qualquer', newPassword: 'NovaSenha123' })
        .expect(400);
      expect(res.body.code).toBe('password.notSet');
    });

    it('não dá para desvincular a única forma de login', async () => {
      const res = await as(token, http().delete('/api/v1/users/me/identities/google')).expect(400);
      expect(res.body.code).toBe('social.lastLoginMethod');
    });
  });

  describe('e-mail que já tem conta CONFIRMADA com senha', () => {
    const password = 'Senha123';

    beforeAll(async () => {
      await users.create(
        { name: 'Bia', email: 'bia@empresa.com', password },
        { emailVerified: true },
      );
    });

    it('e-mail verificado pelo provedor -> VINCULA à conta existente e avisa o dono', async () => {
      const notice = jest.spyOn(mail, 'sendSocialLinked');
      const res = await social('google', {
        idToken: await googleToken({ sub: 'g-bia', email: 'bia@empresa.com' }),
      }).expect(200);

      expect(res.body.user).toMatchObject({ email: 'bia@empresa.com', name: 'Bia' });
      expect(notice).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'bia@empresa.com' }),
        'google',
      );
      const methods = await as(res.body.accessToken, http().get('/api/v1/users/me/identities'));
      expect(methods.body).toMatchObject({
        hasPassword: true,
        identities: [{ provider: 'google' }],
      });
    });

    it('a senha continua funcionando; com senha, dá para desvincular o Google', async () => {
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'bia@empresa.com', password })
        .expect(200);

      await as(login.body.accessToken, http().delete('/api/v1/users/me/identities/google')).expect(
        204,
      );
      await as(login.body.accessToken, http().delete('/api/v1/users/me/identities/google')).expect(
        404,
      );
    });
  });

  describe('pré-sequestro: alguém cadastrou o e-mail da vítima antes dela (conta NÃO confirmada)', () => {
    let attackerToken: string;

    beforeAll(async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ name: 'Atacante', email: 'vitima@gmail.com', password: 'SenhaDoAtacante1' })
        .expect(201);
      attackerToken = res.body.accessToken;
    });

    it('a vítima entra com o Google: a conta é dela, e a senha e as sessões do atacante caem', async () => {
      const res = await social('google', {
        idToken: await googleToken({ sub: 'g-vitima', email: 'vitima@gmail.com' }),
      }).expect(200);
      expect(res.body.user.emailVerifiedAt).toEqual(expect.any(String));

      // a sessão aberta pelo atacante no cadastro não vale mais
      await as(attackerToken, http().get('/api/v1/users/me')).expect(401);
      // e a senha que ele definiu também não
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'vitima@gmail.com', password: 'SenhaDoAtacante1' })
        .expect(401);
      const methods = await as(res.body.accessToken, http().get('/api/v1/users/me/identities'));
      expect(methods.body.hasPassword).toBe(false);
    });
  });

  it('Apple: usa o nome enviado pelo app (a Apple não o coloca no token)', async () => {
    const res = await social('apple', {
      idToken: await appleToken({ sub: 'a-caio', email: 'caio@privaterelay.appleid.com' }),
      name: 'Caio Apple',
      locale: 'en',
    }).expect(200);

    expect(res.body.user).toMatchObject({ name: 'Caio Apple', locale: 'en' });
  });

  it('usuário com 2FA: o login social também exige o segundo passo', async () => {
    const created = await social('google', {
      idToken: await googleToken({ sub: 'g-duda', email: 'duda@gmail.com' }),
    }).expect(200);
    const token = created.body.accessToken as string;

    const { base32Decode, currentStep, hotp } = await import('../src/auth/two-factor/totp');
    // conta sem senha: basta ter entrado agora há pouco (reautenticação recente)
    const { secret } = (await as(token, http().post('/api/v1/auth/2fa/setup')).expect(201)).body;
    await as(token, http().post('/api/v1/auth/2fa/enable'))
      .send({ code: hotp(base32Decode(secret), currentStep()) })
      .expect(200);

    const res = await social('google', {
      idToken: await googleToken({ sub: 'g-duda', email: 'duda@gmail.com' }),
    }).expect(200);
    expect(res.body).toEqual({
      twoFactorRequired: true,
      twoFactorToken: expect.any(String),
      expiresIn: 300,
    });
  });

  it.each([
    ['provedor desconhecido', 'facebook', 400, 'social.unknownProvider'],
    ['token de outro app', 'google', 401, 'social.invalidToken'],
  ])('%s -> %s', async (_, provider, status, code) => {
    const idToken = await oidc.sign({
      iss: ISSUERS.google,
      aud: 'outro-app',
      sub: 'x',
      email: 'x@x.com',
      email_verified: true,
    });
    const res = await social(provider, { idToken }).expect(status);
    expect(res.body.code).toBe(code);
  });

  it('o ID token é obrigatório (validação)', async () => {
    const res = await social('google', {}).expect(400);
    expect(res.body.errors).toContainEqual(
      expect.objectContaining({ field: 'idToken', code: 'validation.isNotEmpty' }),
    );
  });
});
