import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { rmSync } from 'fs';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AuditAction } from '../src/audit/audit-action.enum';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/common/enums/role.enum';
import { StoredFile } from '../src/files/file.entity';
import { MailService } from '../src/mail/mail.service';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { Session } from '../src/sessions/entities/session.entity';
import { User } from '../src/users/entities/user.entity';
import { UsersService } from '../src/users/users.service';

const DAY = 86_400_000;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('Minha conta: exclusão, exportação, anonimização e alertas (e2e)', () => {
  let app: INestApplication<App>;
  let mail: MailService;
  let usersRepo: Repository<User>;
  let adminToken: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', 'pt-BR');
  const login = async (email: string, userAgent = CHROME) =>
    (
      await http()
        .post('/api/v1/auth/login')
        .set('User-Agent', userAgent)
        .send({ email, password: 'Senha123' })
        .expect(200)
    ).body.accessToken as string;
  const createUser = (email: string, role = Role.USER) =>
    app
      .get(UsersService)
      .create({ name: 'Pessoa', email, password: 'Senha123', role }, { emailVerified: true });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
    mail = app.get(MailService);
    usersRepo = app.get(getRepositoryToken(User));

    await createUser('admin@conta.com', Role.ADMIN);
    adminToken = await login('admin@conta.com');
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app.close();
    rmSync(process.env.STORAGE_LOCAL_DIR!, { recursive: true, force: true });
  });

  describe('alerta de login em dispositivo novo', () => {
    it('primeiro login da conta: sem alerta; mesmo dispositivo: sem alerta; outro: alerta', async () => {
      await createUser('alerta@conta.com');
      const alert = jest.spyOn(mail, 'sendNewLogin');

      await login('alerta@conta.com', CHROME);
      await login('alerta@conta.com', CHROME);
      expect(alert).not.toHaveBeenCalled();

      await login('alerta@conta.com', IPHONE);
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert).toHaveBeenCalledWith(expect.objectContaining({ email: 'alerta@conta.com' }), {
        description: 'Safari · iOS',
        ip: expect.any(String),
      });
    });
  });

  describe('exportação dos meus dados (LGPD)', () => {
    it('devolve um JSON para download com tudo — e sem segredos', async () => {
      await createUser('export@conta.com');
      const token = await login('export@conta.com');

      const res = await as(token, http().get('/api/v1/users/me/export')).expect(200);

      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        profile: { email: 'export@conta.com', permissions: [] },
        security: { hasPassword: true, twoFactorEnabled: false, identities: [] },
        sessions: [expect.objectContaining({ userAgent: CHROME })],
        files: [],
        activity: expect.arrayContaining([expect.objectContaining({ action: 'auth.login' })]),
      });
      const raw = JSON.stringify(res.body);
      for (const secret of ['"password":', 'twoFactorSecret', 'tokenHash', '$2a$', '$2b$']) {
        expect(raw).not.toContain(secret);
      }
    });
  });

  describe('excluir minha conta', () => {
    let token: string;
    let userId: string;

    beforeAll(async () => {
      userId = (await createUser('sair@conta.com')).id;
      token = await login('sair@conta.com');
    });

    it('exige a senha atual', async () => {
      const res = await as(token, http().delete('/api/v1/users/me')).expect(400);
      expect(res.body.code).toBe('account.passwordRequired');
      await as(token, http().delete('/api/v1/users/me'))
        .send({ currentPassword: 'Errada123' })
        .expect(400);
    });

    it('com a senha: a conta some, as sessões caem e chega o e-mail com a data da exclusão definitiva', async () => {
      const notice = jest.spyOn(mail, 'sendAccountDeleted');
      await as(token, http().delete('/api/v1/users/me'))
        .send({ currentPassword: 'Senha123' })
        .expect(204);

      expect(notice).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'sair@conta.com' }),
        expect.any(Date),
      );
      await as(token, http().get('/api/v1/users/me')).expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'sair@conta.com', password: 'Senha123' })
        .expect(401);
      // o admin ainda vê (e pode restaurar) durante o prazo
      const deleted = await as(adminToken, http().get('/api/v1/users?deleted=true')).expect(200);
      expect(deleted.body.data.map((u: User) => u.id)).toContain(userId);
    });

    it('o único admin não pode excluir a própria conta', async () => {
      const res = await as(adminToken, http().delete('/api/v1/users/me'))
        .send({ currentPassword: 'Senha123' })
        .expect(400);
      expect(res.body.code).toBe('account.lastAdmin');
    });
  });

  describe('job de manutenção: anonimização e faxina', () => {
    let userId: string;

    beforeAll(async () => {
      userId = (await createUser('apagar@conta.com')).id;
      const token = await login('apagar@conta.com');

      // um avatar, para conferir que os arquivos também saem
      const created = await as(token, http().post('/api/v1/files'))
        .send({ purpose: 'avatar', contentType: 'image/png', size: PNG.length })
        .expect(201);
      let upload = http().post(new URL(created.body.upload.url).pathname);
      for (const [k, v] of Object.entries(created.body.upload.fields as Record<string, string>)) {
        upload = upload.field(k, v);
      }
      await upload.attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(204);
      await as(token, http().post(`/api/v1/files/${created.body.file.id}/complete`)).expect(200);
      await as(token, http().put('/api/v1/users/me/avatar'))
        .send({ fileId: created.body.file.id })
        .expect(200);

      await as(token, http().delete('/api/v1/users/me'))
        .send({ currentPassword: 'Senha123' })
        .expect(204);
    });

    it('antes do prazo (30 dias), nada é apagado', async () => {
      const report = await app.get(MaintenanceService).run(new Date(Date.now() + 29 * DAY));
      expect(report.anonymizedAccounts).toBe(0);
    });

    it('depois do prazo: dados pessoais, arquivos, sessões e IPs da auditoria saem', async () => {
      const report = await app.get(MaintenanceService).run(new Date(Date.now() + 31 * DAY));
      expect(report).toMatchObject({ anonymizedAccounts: 2 }); // esta e a "sair@" do bloco anterior

      const user = await usersRepo.findOneOrFail({ where: { id: userId }, withDeleted: true });
      expect(user).toMatchObject({
        name: 'Deleted user',
        email: `deleted-${userId}@deleted.invalid`,
        avatarUrl: null,
        isActive: false,
        anonymizedAt: expect.any(Date),
      });
      expect(
        await app.get(getRepositoryToken(StoredFile)).count({ where: { ownerId: userId } }),
      ).toBe(0);
      expect(await app.get(getRepositoryToken(Session)).count({ where: { userId } })).toBe(0);
      const logs = await app
        .get<Repository<AuditLog>>(getRepositoryToken(AuditLog))
        .find({ where: { actorId: userId } });
      expect(logs.length).toBeGreaterThan(0); // o QUE aconteceu continua registrado...
      for (const log of logs.filter((l) => l.action !== AuditAction.USER_ANONYMIZED)) {
        expect(log).toMatchObject({ ip: null, userAgent: null, metadata: null }); // ...sem dados pessoais
      }
    });

    it('conta anonimizada não pode mais ser restaurada', async () => {
      const res = await as(adminToken, http().patch(`/api/v1/users/${userId}/restore`)).expect(400);
      expect(res.body.code).toBe('users.anonymized');
    });

    it('rodar de novo não refaz nada (idempotente)', async () => {
      const report = await app.get(MaintenanceService).run(new Date(Date.now() + 31 * DAY));
      expect(report.anonymizedAccounts).toBe(0);
    });

    it('apaga sessões encerradas há mais de 30 dias e auditoria fora da retenção (365 dias)', async () => {
      const report = await app.get(MaintenanceService).run(new Date(Date.now() + 400 * DAY));
      expect(report.deletedSessions).toBeGreaterThan(0);
      expect(report.deletedAuditLogs).toBeGreaterThan(0);
      expect(await app.get(getRepositoryToken(AuditLog)).count()).toBe(0);
    });
  });

  describe('permissões (e não roles) nas rotas de admin', () => {
    it('manager tem users:read mas não users:delete', async () => {
      const manager = await createUser('gerente@conta.com', Role.MANAGER);
      const token = await login('gerente@conta.com');
      await as(token, http().get('/api/v1/users')).expect(200);
      const res = await as(token, http().delete(`/api/v1/users/${manager.id}`)).expect(403);
      expect(res.body.code).toBe('auth.forbidden');
    });
  });
});
