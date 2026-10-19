import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { IsNull, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AuditAction } from '../src/audit/audit-action.enum';
import { AuditLog } from '../src/audit/audit-log.entity';
import { MailService } from '../src/mail/mail.service';
import { User } from '../src/users/entities/user.entity';
import { UsersService } from '../src/users/users.service';
import { FakeAuthenticator } from './passkeys/fake-authenticator';

// FRONTEND_URL dos testes (test/setup-env.ts): a passkey fica presa a esse domínio
const RP_ID = 'front.test';
const ORIGIN = 'http://front.test';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0';

interface Options {
  options: { challenge: string; user: { id: string }; rp: { id: string } };
  challengeToken: string;
}

describe('Passkeys (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let audit: Repository<AuditLog>;
  let sendPasskeyAdded: jest.SpyInstance;

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  async function createUser(email: string): Promise<{ id: string; token: string }> {
    const user = await app
      .get(UsersService)
      .create({ name: 'Ana', email, password: 'Senha123' }, { emailVerified: true });
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'Senha123' })
      .expect(200);
    return { id: user.id, token: res.body.accessToken };
  }

  async function registerOptions(token: string): Promise<Options> {
    return (
      await as(token, http().post('/api/v1/auth/passkeys/register/options'))
        .send({ currentPassword: 'Senha123' })
        .expect(200)
    ).body;
  }

  /** Cadastra uma passkey nova para o usuário e devolve o autenticador dela. */
  async function addPasskey(token: string): Promise<FakeAuthenticator> {
    const device = new FakeAuthenticator(RP_ID, ORIGIN);
    const { options, challengeToken } = await registerOptions(token);
    await as(token, http().post('/api/v1/auth/passkeys/register'))
      .set('User-Agent', CHROME)
      .send({ challengeToken, response: device.register(options) })
      .expect(201);
    return device;
  }

  const loginOptions = async (): Promise<Options> =>
    (await http().post('/api/v1/auth/passkeys/login/options').expect(200)).body;

  async function loginWith(device: FakeAuthenticator, origin?: string) {
    const { options, challengeToken } = await loginOptions();
    return http()
      .post('/api/v1/auth/passkeys/login')
      .send({ challengeToken, response: device.login(options, origin) });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
    usersRepo = app.get(getRepositoryToken(User));
    audit = app.get(getRepositoryToken(AuditLog));
    sendPasskeyAdded = jest.spyOn(app.get(MailService), 'sendPasskeyAdded');
  });

  afterAll(() => app.close());

  describe('cadastro', () => {
    let ana: { id: string; token: string };

    beforeAll(async () => {
      ana = await createUser('ana.passkey@test.com');
    });

    it('pede a senha antes (uma passkey é uma nova forma de entrar)', async () => {
      const res = await as(ana.token, http().post('/api/v1/auth/passkeys/register/options'))
        .send({})
        .expect(400);
      expect(res.body.code).toBe('account.passwordRequired');
    });

    it('as opções vêm presas ao domínio do front e à pessoa', async () => {
      const { options } = await registerOptions(ana.token);
      expect(options.rp.id).toBe(RP_ID);
      expect(Buffer.from(options.user.id, 'base64url').toString()).toBe(ana.id);
    });

    it('cadastra, dá um nome de dispositivo, audita e avisa por e-mail', async () => {
      await addPasskey(ana.token);

      const list = (await as(ana.token, http().get('/api/v1/users/me/passkeys')).expect(200)).body;
      expect(list).toEqual([
        expect.objectContaining({ name: 'Chrome · Windows', lastUsedAt: null }),
      ]);
      expect(list[0]).not.toHaveProperty('publicKey');
      expect(sendPasskeyAdded).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ana.passkey@test.com' }),
        'Chrome · Windows',
      );
      expect(
        await audit.count({ where: { action: AuditAction.AUTH_PASSKEY_ADDED, actorId: ana.id } }),
      ).toBe(1);

      const methods = (await as(ana.token, http().get('/api/v1/users/me/identities'))).body;
      expect(methods.passkeys).toBe(1);
    });

    it('o desafio vale uma vez só', async () => {
      const device = new FakeAuthenticator(RP_ID, ORIGIN);
      const { options, challengeToken } = await registerOptions(ana.token);
      const response = device.register(options);
      await as(ana.token, http().post('/api/v1/auth/passkeys/register'))
        .send({ challengeToken, response })
        .expect(201);

      const again = await as(ana.token, http().post('/api/v1/auth/passkeys/register'))
        .send({ challengeToken, response })
        .expect(400);
      expect(again.body.code).toBe('passkeys.challengeExpired');
    });

    it('a mesma passkey não entra duas vezes', async () => {
      const device = await addPasskey(ana.token);
      const { options, challengeToken } = await registerOptions(ana.token);
      const res = await as(ana.token, http().post('/api/v1/auth/passkeys/register'))
        .send({ challengeToken, response: device.register(options) })
        .expect(400);
      expect(res.body.code).toBe('passkeys.alreadyRegistered');
    });

    it('resposta de outro site (origem diferente) é recusada', async () => {
      const device = new FakeAuthenticator(RP_ID, 'https://golpe.example');
      const { options, challengeToken } = await registerOptions(ana.token);
      const res = await as(ana.token, http().post('/api/v1/auth/passkeys/register'))
        .send({ challengeToken, response: device.register(options) })
        .expect(400);
      expect(res.body.code).toBe('passkeys.verificationFailed');
    });

    it('o desafio de um usuário não serve para outro', async () => {
      const bia = await createUser('bia.passkey@test.com');
      const device = new FakeAuthenticator(RP_ID, ORIGIN);
      const { options, challengeToken } = await registerOptions(ana.token);
      const res = await as(bia.token, http().post('/api/v1/auth/passkeys/register'))
        .send({ challengeToken, response: device.register(options) })
        .expect(400);
      expect(res.body.code).toBe('passkeys.challengeExpired');
    });
  });

  describe('login', () => {
    let carla: { id: string; token: string };
    let device: FakeAuthenticator;

    beforeAll(async () => {
      carla = await createUser('carla.passkey@test.com');
      device = await addPasskey(carla.token);
    });

    it('entra sem e-mail nem senha e registra o último uso', async () => {
      const res = await loginWith(device);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('carla.passkey@test.com');
      await as(res.body.accessToken, http().get('/api/v1/users/me')).expect(200);

      const [passkey] = (await as(carla.token, http().get('/api/v1/users/me/passkeys'))).body;
      expect(passkey.lastUsedAt).not.toBeNull();
      const login = await audit.findOne({
        where: { action: AuditAction.AUTH_LOGIN, actorId: carla.id },
        order: { createdAt: 'DESC' },
      });
      expect(login?.metadata).toMatchObject({ method: 'passkey' });
    });

    it('com 2FA ativo, entra direto: a passkey já vale como dois fatores', async () => {
      await usersRepo.update(carla.id, { twoFactorEnabledAt: new Date() });
      const res = await loginWith(device);
      await usersRepo.update(carla.id, { twoFactorEnabledAt: null });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body).not.toHaveProperty('twoFactorRequired');
    });

    it('a mesma resposta não entra duas vezes', async () => {
      const { options, challengeToken } = await loginOptions();
      const response = device.login(options);
      await http()
        .post('/api/v1/auth/passkeys/login')
        .send({ challengeToken, response })
        .expect(200);

      const replay = await http()
        .post('/api/v1/auth/passkeys/login')
        .send({ challengeToken, response })
        .expect(400);
      expect(replay.body.code).toBe('passkeys.challengeExpired');
    });

    it('assinatura feita para outro site é recusada', async () => {
      const res = await loginWith(device, 'https://golpe.example');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('passkeys.invalid');
    });

    it('contador que volta para trás (credencial clonada) é recusado', async () => {
      device.counter = 0;
      const res = await loginWith(device);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('passkeys.invalid');
      device.counter = 100;
    });

    it('passkey desconhecida é recusada e auditada', async () => {
      const stranger = new FakeAuthenticator(RP_ID, ORIGIN);
      stranger.register({ challenge: 'x', user: { id: 'x' } });
      const res = await loginWith(stranger);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('passkeys.invalid');
      const failed = await audit.find({
        where: { action: AuditAction.AUTH_LOGIN_FAILED, actorId: IsNull() },
      });
      expect(failed.map((l) => l.metadata)).toContainEqual({
        method: 'passkey',
        reason: 'unknown_passkey',
      });
    });

    it('conta desativada não entra', async () => {
      await usersRepo.update(carla.id, { isActive: false });
      const res = await loginWith(device);
      await usersRepo.update(carla.id, { isActive: true });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('auth.userInactive');
    });
  });

  describe('gerenciar', () => {
    let dani: { id: string; token: string };
    let device: FakeAuthenticator;
    let passkeyId: string;

    beforeAll(async () => {
      dani = await createUser('dani.passkey@test.com');
      device = await addPasskey(dani.token);
      passkeyId = (await as(dani.token, http().get('/api/v1/users/me/passkeys'))).body[0].id;
    });

    it('renomeia', async () => {
      const res = await as(dani.token, http().patch(`/api/v1/users/me/passkeys/${passkeyId}`))
        .send({ name: 'Notebook do trabalho' })
        .expect(200);
      expect(res.body.name).toBe('Notebook do trabalho');
    });

    it('outra pessoa não mexe na passkey de ninguém', async () => {
      const eva = await createUser('eva.passkey@test.com');
      await as(eva.token, http().delete(`/api/v1/users/me/passkeys/${passkeyId}`)).expect(404);
    });

    it('removida, para de entrar na hora', async () => {
      await as(dani.token, http().delete(`/api/v1/users/me/passkeys/${passkeyId}`)).expect(204);

      expect((await as(dani.token, http().get('/api/v1/users/me/passkeys'))).body).toEqual([]);
      expect((await loginWith(device)).status).toBe(401);
      expect(
        await audit.count({
          where: { action: AuditAction.AUTH_PASSKEY_REMOVED, actorId: dani.id },
        }),
      ).toBe(1);
    });
  });
});
