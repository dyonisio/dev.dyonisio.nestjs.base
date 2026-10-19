import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { MailService } from '../src/mail/mail.service';
import { User } from '../src/users/entities/user.entity';
import { UsersService } from '../src/users/users.service';

/**
 * Login por link mágico: entra sem digitar a senha, mas só quem abre o e-mail.
 * E a primeira senha (com o "Bem-vindo") de quem foi convidado e entrou pelo link.
 */
describe('Link mágico (e2e)', () => {
  let app: INestApplication<App>;
  let users: UsersService;
  let repo: Repository<User>;
  let mail: MailService;

  const http = () => request(app.getHttpServer());
  const askLink = (email: string) => http().post('/api/v1/auth/magic-link').send({ email });
  const useLink = (token: string) => http().post('/api/v1/auth/magic-link/verify').send({ token });
  const login = (email: string, password: string) =>
    http().post('/api/v1/auth/login').send({ email, password });

  /** Pede o link e devolve o token que foi para o e-mail. */
  async function linkFor(email: string): Promise<string> {
    const spy = jest.spyOn(mail, 'sendMagicLink');
    await askLink(email).expect(200);
    const url = spy.mock.calls.at(-1)![1].url;
    spy.mockRestore();
    return new URL(url).searchParams.get('token')!;
  }

  const create = (email: string, extra: Partial<{ password: string; verified: boolean }> = {}) =>
    users.create(
      { name: 'Pessoa Teste', email, password: extra.password ?? 'Senha123', role: Role.USER },
      { emailVerified: extra.verified ?? true },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
    users = app.get(UsersService);
    repo = app.get(getRepositoryToken(User));
    mail = app.get(MailService);
  });

  afterAll(() => app.close());
  afterEach(() => jest.restoreAllMocks());

  describe('pedir o link', () => {
    it('manda o link para o e-mail da conta, com validade e de onde foi pedido', async () => {
      await create('ana@link.com');
      const spy = jest.spyOn(mail, 'sendMagicLink');

      const res = await askLink('ana@link.com')
        .set('User-Agent', 'Mozilla/5.0 Chrome/141')
        .expect(200);

      expect(res.body.message).toEqual(expect.any(String));
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ana@link.com' }),
        expect.objectContaining({
          url: expect.stringContaining('http://front.test/magic-link?token='),
          expiresInMinutes: 15,
        }),
      );
    });

    it('e-mail sem conta: mesma resposta, nenhum e-mail (não revela quem tem conta)', async () => {
      const spy = jest.spyOn(mail, 'sendMagicLink');
      const known = await askLink('ana@link.com').expect(200);
      spy.mockClear();

      const unknown = await askLink('ninguem@link.com').expect(200);

      expect(unknown.body).toEqual(known.body);
      expect(spy).not.toHaveBeenCalled();
    });

    it('conta desativada não recebe link', async () => {
      const user = await create('desativada@link.com');
      await repo.update(user.id, { isActive: false });
      const spy = jest.spyOn(mail, 'sendMagicLink');

      await askLink('desativada@link.com').expect(200);

      expect(spy).not.toHaveBeenCalled();
    });

    it('pedir o link NÃO abre sessão: a resposta não tem tokens', async () => {
      const res = await askLink('ana@link.com').expect(200);
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();
    });
  });

  describe('usar o link', () => {
    it('entra pelo link, e o link vale uma vez só', async () => {
      const token = await linkFor('ana@link.com');

      const res = await useLink(token).expect(200);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        user: { email: 'ana@link.com' },
      });
      await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);

      const again = await useLink(token).expect(400);
      expect(again.body.code).toBe('auth.invalidMagicLink');
    });

    it('dois cliques ao mesmo tempo: só um entra', async () => {
      const token = await linkFor('ana@link.com');
      const results = await Promise.all([useLink(token), useLink(token)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('pedir outro link invalida o anterior', async () => {
      const first = await linkFor('ana@link.com');
      const second = await linkFor('ana@link.com');

      await useLink(first).expect(400);
      await useLink(second).expect(200);
    });

    it('trocar o e-mail da conta invalida o link enviado para o antigo', async () => {
      const user = await create('mudou@link.com');
      const token = await linkFor('mudou@link.com');
      await repo.update(user.id, { email: 'novo-endereco@link.com' });

      await useLink(token).expect(400);
    });

    it('com 2FA ativo, o link leva ao código do app, sem tokens', async () => {
      const user = await create('dois-fatores@link.com');
      await repo.update(user.id, { twoFactorEnabledAt: new Date() });
      const token = await linkFor('dois-fatores@link.com');

      const res = await useLink(token).expect(200);

      expect(res.body).toMatchObject({
        twoFactorRequired: true,
        twoFactorToken: expect.any(String),
      });
      expect(res.body.accessToken).toBeUndefined();
    });

    it('token forjado, de outra finalidade ou com lixo: recusado', async () => {
      const user = await users.findByEmail('ana@link.com');
      const jwt = app.get(JwtService);
      // assinado com o segredo principal (não o derivado do link mágico)
      const forged = await jwt.signAsync(
        { sub: user!.id, purpose: 'magic-link', email: 'ana@link.com', nonce: 'x' },
        { secret: process.env.JWT_SECRET, expiresIn: 600 },
      );

      await useLink(forged).expect(400);
      await useLink('nao-e-um-token').expect(400);
    });

    it('conta nunca confirmada: o link prova o e-mail e descarta a senha de quem a criou (pré-sequestro)', async () => {
      // Alguém cadastrou o e-mail da vítima com uma senha que ele conhece...
      await create('vitima@link.com', { password: 'SenhaDoAtacante1', verified: false });
      // ...a vítima entra pelo link que chegou no e-mail dela
      const token = await linkFor('vitima@link.com');
      const res = await useLink(token).expect(200);

      expect(res.body.user.emailVerifiedAt).toEqual(expect.any(String));
      await login('vitima@link.com', 'SenhaDoAtacante1').expect(401);
    });
  });

  describe('convidado que entra pelo link e cria a senha', () => {
    async function invitedSession(email: string) {
      await users.create(
        { name: 'Convidado Link', email, role: Role.USER },
        { emailVerified: true },
      );
      const res = await useLink(await linkFor(email)).expect(200);
      return res.body.accessToken as string;
    }

    it('cria a primeira senha, recebe o Bem-vindo e passa a entrar com ela', async () => {
      const welcome = jest.spyOn(mail, 'sendWelcome');
      const changed = jest.spyOn(mail, 'sendPasswordChanged');
      const token = await invitedSession('convidado@link.com');

      const res = await http()
        .post('/api/v1/auth/password/set')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: 'MinhaSenha1' })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(welcome).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'convidado@link.com' }),
      );
      expect(changed).not.toHaveBeenCalled();
      await login('convidado@link.com', 'MinhaSenha1').expect(200);
    });

    it('quem já tem senha não usa esta rota (troca exige a senha atual)', async () => {
      const token = (await login('convidado@link.com', 'MinhaSenha1').expect(200)).body.accessToken;

      const res = await http()
        .post('/api/v1/auth/password/set')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: 'OutraSenha1' })
        .expect(400);

      expect(res.body.code).toBe('password.alreadySet');
    });

    it('com 2FA, criar a senha pede o código do app', async () => {
      const token = await invitedSession('convidado2fa@link.com');
      const user = await users.findByEmail('convidado2fa@link.com');
      await repo.update(user!.id, { twoFactorEnabledAt: new Date() });

      const res = await http()
        .post('/api/v1/auth/password/set')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: 'MinhaSenha1' })
        .expect(400);

      expect(res.body.code).toBe('twoFactor.codeRequired');
    });

    it('sem login não cria senha', async () => {
      await http()
        .post('/api/v1/auth/password/set')
        .send({ newPassword: 'MinhaSenha1' })
        .expect(401);
    });
  });
});
