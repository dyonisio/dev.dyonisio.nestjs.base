import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { MailService } from '../src/mail/mail.service';
import { UsersService } from '../src/users/users.service';

interface Session {
  accessToken: string;
  refreshToken: string;
}

describe('API (e2e)', () => {
  let app: INestApplication<App>;
  let mail: MailService;
  let admin: Session;
  let user: Session;
  let userId: string;
  let verifyLink: string;

  const ADMIN = { name: 'Admin', email: 'admin@test.com', password: 'Admin123' };
  const USER = { name: 'Maria', email: 'maria@test.com', password: 'Senha123' };

  const http = () => request(app.getHttpServer());

  const me = (accessToken: string) =>
    http().get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);

  const login = async (email: string, password: string): Promise<Session> => {
    const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();

    mail = app.get(MailService);
    await app.get(UsersService).create({ ...ADMIN, role: Role.ADMIN }, { emailVerified: true });
    admin = await login(ADMIN.email, ADMIN.password);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.restoreAllMocks());

  it('GET /api/health — público', () =>
    http()
      .get('/api/health')
      .expect(200)
      .expect((res) => expect(res.body).toMatchObject({ status: 'ok', database: 'up' })));

  describe('X-Request-Id', () => {
    it('toda resposta traz um id gerado pela API', async () => {
      const res = await http().get('/api/health').expect(200);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('reaproveita o id enviado pelo cliente', async () => {
      const res = await http().get('/api/health').set('X-Request-Id', 'front-123').expect(200);
      expect(res.headers['x-request-id']).toBe('front-123');
    });

    it('o corpo do erro traz o mesmo id do header (para o suporte achar o log)', async () => {
      const res = await http().get('/api/v1/users/me').expect(401);
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });
  });

  it('GET /docs-json — documento Swagger com as rotas separadas', () =>
    http()
      .get('/docs-json')
      .expect(200)
      .expect((res) => {
        expect(Object.keys(res.body.paths)).toEqual(
          expect.arrayContaining([
            '/api/v1/auth/login',
            '/api/v1/auth/refresh',
            '/api/v1/auth/logout',
            '/api/v1/auth/register',
            '/api/v1/auth/password/forgot',
            '/api/v1/auth/password/reset',
            '/api/v1/auth/password/change',
            '/api/v1/users/me',
          ]),
        );
        expect(res.body.paths).not.toHaveProperty('/api/v1/auth/me');
      }));

  describe('Cadastro — /auth/register', () => {
    it('cria usuário não verificado, envia o link de confirmação, já autentica e nunca expõe a senha', async () => {
      const verifyMail = jest.spyOn(mail, 'sendVerifyEmail');

      const res = await http().post('/api/v1/auth/register').send(USER).expect(201);

      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
      });
      expect(res.body.user).toMatchObject({
        email: USER.email,
        role: Role.USER,
        emailVerifiedAt: null,
      });
      expect(res.body.user).not.toHaveProperty('password');
      expect(verifyMail).toHaveBeenCalledWith(
        expect.objectContaining({ email: USER.email }),
        expect.stringMatching(/^http:\/\/front\.test\/verify-email\?token=/),
        24,
      );

      user = res.body;
      userId = res.body.user.id;
      verifyLink = verifyMail.mock.calls[0][1];
    });

    it('confirma o e-mail pelo link e envia as boas-vindas', async () => {
      const welcome = jest.spyOn(mail, 'sendWelcome');
      const token = new URL(verifyLink).searchParams.get('token');

      await http().post('/api/v1/auth/email/verify').send({ token }).expect(200);

      expect(welcome).toHaveBeenCalledWith(expect.objectContaining({ email: USER.email }));
      const me = await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(me.body.emailVerifiedAt).toEqual(expect.any(String));
      // permissões calculadas pela role, para o front mostrar/esconder ações
      expect(me.body.permissions).toEqual([]);
      const adminMe = await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(adminMe.body.permissions).toEqual(
        expect.arrayContaining(['users:read', 'audit:read']),
      );
    });

    it('rejeita tentativa de se cadastrar como admin', () =>
      http()
        .post('/api/v1/auth/register')
        .send({ name: 'Hacker', email: 'h@test.com', password: 'Senha123', role: 'admin' })
        .expect(400));

    it('409 para e-mail duplicado', () =>
      http().post('/api/v1/auth/register').send(USER).expect(409));

    it('400 para payload inválido', () =>
      http()
        .post('/api/v1/auth/register')
        .send({ name: '', email: 'invalido', password: '123' })
        .expect(400));
  });

  describe('Sessão — /auth/login, /auth/refresh, /auth/logout', () => {
    it('login — 401 com senha errada', () =>
      http()
        .post('/api/v1/auth/login')
        .send({ email: USER.email, password: 'errada' })
        .expect(401));

    it('GET /api/v1/users/me — 401 sem token', () => http().get('/api/v1/users/me').expect(401));

    it('GET /api/v1/users/me — retorna o usuário autenticado', () =>
      http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.email).toBe(USER.email);
          expect(res.body).not.toHaveProperty('password');
        }));

    it('refresh — troca o refresh token por um novo par (rotação)', async () => {
      const res = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(200);

      expect(res.body.refreshToken).not.toBe(user.refreshToken);
      expect(res.body.user.email).toBe(USER.email);

      await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);

      user = res.body;
    });

    it('refresh — reusar um token já usado derruba a sessão inteira, inclusive o access token', async () => {
      // Cenário: login -> refresh -> usa o novo access token -> tenta o refresh antigo de novo
      const otherDevice = await login(USER.email, USER.password);
      const old = user.refreshToken;
      const rotated = (
        await http().post('/api/v1/auth/refresh').send({ refreshToken: old }).expect(200)
      ).body as Session;
      await me(rotated.accessToken).expect(200);

      // reuso do token antigo (simula token roubado)
      await http().post('/api/v1/auth/refresh').send({ refreshToken: old }).expect(401);

      // a sessão comprometida caiu por completo: refresh novo E access token novo
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.refreshToken })
        .expect(401);
      await me(rotated.accessToken).expect(401);

      // as outras sessões do usuário (outro dispositivo) seguem funcionando
      await me(otherDevice.accessToken).expect(200);

      user = await login(USER.email, USER.password);
    });

    it('refresh — 401 para token inválido', () =>
      http().post('/api/v1/auth/refresh').send({ refreshToken: 'lixo' }).expect(401));

    it('logout — revoga o refresh token e o access token da sessão na hora', async () => {
      const session = await login(USER.email, USER.password);
      await me(session.accessToken).expect(200);

      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(204);

      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await me(session.accessToken).expect(401);
      // logout de uma sessão não afeta as outras
      await me(user.accessToken).expect(200);
    });
  });

  describe('Roles', () => {
    it('GET /api/v1/users — 403 para role "user"', () =>
      http().get('/api/v1/users').set('Authorization', `Bearer ${user.accessToken}`).expect(403));

    it('GET /api/v1/users — admin lista com paginação', () =>
      http()
        .get('/api/v1/users?page=1&limit=10')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toHaveLength(2);
          expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });
          expect(res.body.data[0]).not.toHaveProperty('password');
        }));

    it('PATCH /api/v1/users/:id/role — admin promove usuário a manager (com e-mail)', async () => {
      const roleMail = jest.spyOn(mail, 'sendRoleChanged');

      await http()
        .patch(`/api/v1/users/${userId}/role`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ role: Role.MANAGER })
        .expect(200)
        .expect((res) => expect(res.body.role).toBe(Role.MANAGER));

      expect(roleMail).toHaveBeenCalledWith(expect.anything(), Role.USER, Role.MANAGER);
    });

    it('a nova role vale imediatamente com o mesmo token (manager pode listar)', () =>
      http().get('/api/v1/users').set('Authorization', `Bearer ${user.accessToken}`).expect(200));

    it('POST /api/v1/users — 403 para manager (somente admin)', () =>
      http()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Novo', email: 'novo@test.com', password: 'Senha123' })
        .expect(403));

    it('PATCH /api/v1/users/me — usuário edita o próprio perfil', () =>
      http()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Maria Souza' })
        .expect(200)
        .expect((res) => expect(res.body.name).toBe('Maria Souza')));
  });

  describe('Senha — /auth/password/*', () => {
    it('forgot + reset — fluxo completo, token de uso único e sessões encerradas', async () => {
      const forgot = jest.spyOn(mail, 'sendForgotPassword');

      await http().post('/api/v1/auth/password/forgot').send({ email: USER.email }).expect(200);

      const token = new URL(forgot.mock.calls[0][1]).searchParams.get('token');

      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'NovaSenha123' })
        .expect(200);

      // sessões abertas antes da redefinição caem: refresh e access token
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
      await me(user.accessToken).expect(401);

      user = await login(USER.email, 'NovaSenha123');

      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'OutraSenha123' })
        .expect(400);
    });

    it('forgot — 200 mesmo para e-mail inexistente (não revela cadastro)', () =>
      http().post('/api/v1/auth/password/forgot').send({ email: 'ninguem@test.com' }).expect(200));

    it('change — troca a senha, encerra outras sessões e devolve novos tokens', async () => {
      const otherSession = await login(USER.email, 'NovaSenha123');

      const res = await http()
        .post('/api/v1/auth/password/change')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ currentPassword: 'NovaSenha123', newPassword: 'Trocada123' })
        .expect(200);

      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: otherSession.refreshToken })
        .expect(401);
      await me(otherSession.accessToken).expect(401);
      await me(user.accessToken).expect(401); // token usado na própria requisição também cai

      // ...e os tokens devolvidos pela troca de senha funcionam
      await me(res.body.accessToken).expect(200);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: res.body.refreshToken })
        .expect(200);

      await login(USER.email, 'Trocada123');
    });

    it('change — 400 com a senha atual errada', () =>
      http()
        .post('/api/v1/auth/password/change')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ currentPassword: 'errada', newPassword: 'Trocada123' })
        .expect(400));
  });

  describe('Remoção', () => {
    it('DELETE /api/v1/users/:id — admin remove (com refresh tokens); o token deixa de valer', async () => {
      const session = await login(USER.email, 'Trocada123');

      await http()
        .delete(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(204);

      await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
    });
  });
});
