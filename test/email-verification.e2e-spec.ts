import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { MailService } from '../src/mail/mail.service';
import { UsersService } from '../src/users/users.service';

describe('Verificação de e-mail (e2e)', () => {
  let app: INestApplication<App>;
  let mail: MailService;
  let adminToken: string;
  let userToken: string;
  let userId: string;
  let firstLink: string;

  const http = () => request(app.getHttpServer());
  const tokenOf = (link: string) => new URL(link).searchParams.get('token');
  const listUsers = (token: string) =>
    http()
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'pt-BR');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
    mail = app.get(MailService);

    await app
      .get(UsersService)
      .create(
        { name: 'Admin', email: 'admin-ev@test.com', password: 'Admin123', role: Role.ADMIN },
        { emailVerified: true },
      );
    adminToken = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'admin-ev@test.com', password: 'Admin123' })
        .expect(200)
    ).body.accessToken;

    // Novo usuário (não verificado), promovido a manager para ter acesso a GET /api/v1/users
    const verifyMail = jest.spyOn(mail, 'sendVerifyEmail');
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Ana', email: 'ana@test.com', password: 'Senha123' })
      .expect(201);
    userToken = res.body.accessToken;
    userId = res.body.user.id;
    firstLink = verifyMail.mock.calls[0][1];

    await http()
      .patch(`/api/v1/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: Role.MANAGER })
      .expect(200);
  });

  afterAll(() => app.close());
  afterEach(() => jest.restoreAllMocks());

  describe('antes de confirmar', () => {
    it('rotas protegidas respondem 403 com código e mensagem traduzida', async () => {
      const res = await listUsers(userToken).expect(403);
      expect(res.body).toEqual({
        statusCode: 403,
        requestId: expect.any(String),
        code: 'auth.emailNotVerified',
        message: 'Confirme seu e-mail para continuar',
      });
    });

    it('rotas liberadas (@AllowUnverified) continuam acessíveis: ver o próprio perfil', () =>
      http().get('/api/v1/users/me').set('Authorization', `Bearer ${userToken}`).expect(200));

    it('reenviar o link envia um novo e-mail', async () => {
      const verifyMail = jest.spyOn(mail, 'sendVerifyEmail');

      await http()
        .post('/api/v1/auth/email/resend')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(verifyMail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ana@test.com' }),
        expect.any(String),
        24,
      );
    });

    it('link adulterado/inválido -> 400', async () => {
      const res = await http()
        .post('/api/v1/auth/email/verify')
        .set('Accept-Language', 'en')
        .send({ token: 'lixo' })
        .expect(400);
      expect(res.body.code).toBe('emailVerification.invalidToken');
    });

    it('o token de confirmação NÃO funciona como access token', () =>
      http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenOf(firstLink)}`)
        .expect(401));
  });

  describe('confirmando', () => {
    it('o link confirma o e-mail, envia boas-vindas e libera o acesso na hora (mesmo token)', async () => {
      const welcome = jest.spyOn(mail, 'sendWelcome');

      await http()
        .post('/api/v1/auth/email/verify')
        .send({ token: tokenOf(firstLink) })
        .expect(200);

      expect(welcome).toHaveBeenCalledTimes(1);
      await listUsers(userToken).expect(200);
    });

    it('clicar no link de novo é idempotente (200, sem novo e-mail de boas-vindas)', async () => {
      const welcome = jest.spyOn(mail, 'sendWelcome');

      await http()
        .post('/api/v1/auth/email/verify')
        .send({ token: tokenOf(firstLink) })
        .expect(200);

      expect(welcome).not.toHaveBeenCalled();
    });

    it('reenviar depois de confirmado -> 400', async () => {
      const res = await http()
        .post('/api/v1/auth/email/resend')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);
      expect(res.body.code).toBe('emailVerification.alreadyVerified');
    });
  });

  describe('trocando o e-mail (com confirmação do endereço novo)', () => {
    let newLink: string;
    const me = () => http().get('/api/v1/users/me').set('Authorization', `Bearer ${userToken}`);
    const changeEmail = (body: object) =>
      http()
        .post('/api/v1/users/me/email')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Accept-Language', 'pt-BR')
        .send(body);

    it('PATCH /users/me não troca mais o e-mail (campo não permitido)', () =>
      http()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'ana.nova@test.com' })
        .expect(400));

    it('exige a senha atual (um token roubado não basta para trocar o e-mail)', async () => {
      const missing = await changeEmail({ newEmail: 'ana.nova@test.com' }).expect(400);
      expect(missing.body.code).toBe('account.passwordRequired');
      const wrong = await changeEmail({
        newEmail: 'ana.nova@test.com',
        currentPassword: 'Errada123',
      }).expect(400);
      expect(wrong.body.code).toBe('password.wrongCurrentPassword');
    });

    it('e-mail já usado por outra conta -> 409', () =>
      changeEmail({ newEmail: 'admin-ev@test.com', currentPassword: 'Senha123' }).expect(409));

    it('com a senha: o link vai para o endereço NOVO e a conta continua com o antigo', async () => {
      const verifyMail = jest.spyOn(mail, 'sendVerifyEmail');

      const res = await changeEmail({
        newEmail: 'ana.nova@test.com',
        currentPassword: 'Senha123',
      }).expect(202);

      expect(res.body).toEqual({
        pendingEmail: 'ana.nova@test.com',
        message: expect.stringContaining('ana.nova@test.com'),
      });
      expect(verifyMail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ana.nova@test.com' }),
        expect.any(String),
        24,
      );
      newLink = verifyMail.mock.calls[0][1];
      const profile = (await me().expect(200)).body;
      expect(profile).toMatchObject({ email: 'ana@test.com', pendingEmail: 'ana.nova@test.com' });
      expect(profile.emailVerifiedAt).toEqual(expect.any(String)); // continua confirmado
    });

    it('um pedido mais novo invalida o link do anterior', async () => {
      const verifyMail = jest.spyOn(mail, 'sendVerifyEmail');
      await changeEmail({ newEmail: 'ana.outra@test.com', currentPassword: 'Senha123' }).expect(
        202,
      );
      const otherLink = verifyMail.mock.calls[0][1];

      await http()
        .post('/api/v1/auth/email/verify')
        .send({ token: tokenOf(newLink) })
        .expect(400);
      newLink = otherLink;
    });

    it('o link confirma: o e-mail muda e o endereço ANTIGO é avisado', async () => {
      const notice = jest.spyOn(mail, 'sendEmailChanged');
      await http()
        .post('/api/v1/auth/email/verify')
        .send({ token: tokenOf(newLink) })
        .expect(200);

      expect(notice).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ana@test.com' }),
        'ana.outra@test.com',
      );
      expect((await me().expect(200)).body).toMatchObject({
        email: 'ana.outra@test.com',
        pendingEmail: null,
      });
      // usar o link de novo não faz nada (idempotente)
      await http()
        .post('/api/v1/auth/email/verify')
        .send({ token: tokenOf(newLink) })
        .expect(200);
    });

    it('agora o login é com o e-mail novo', async () => {
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ana.outra@test.com', password: 'Senha123' })
        .expect(200);
    });
  });

  it('usuário criado por um admin já nasce verificado', async () => {
    const res = await http()
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bia', email: 'bia@test.com', password: 'Senha123' })
      .expect(201);
    expect(res.body.emailVerifiedAt).toEqual(expect.any(String));
  });
});
