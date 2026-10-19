import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { MailService } from '../src/mail/mail.service';
import { UsersService } from '../src/users/users.service';

/** Busca/ordenação, soft delete + restauração e trilha de auditoria. */
describe('Administração de usuários (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let adminId: string;
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);
  const list = (query: string) => asAdmin(http().get(`/api/v1/users?${query}`));
  const names = (res: request.Response) => (res.body.data as { name: string }[]).map((u) => u.name);
  const login = (email: string, password = 'Senha123') =>
    http().post('/api/v1/auth/login').send({ email, password });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();

    const admin = await app
      .get(UsersService)
      .create(
        { name: 'Zeca Admin', email: 'admin@adm.com', password: 'Admin123', role: Role.ADMIN },
        { emailVerified: true },
      );
    adminId = admin.id;
    adminToken = (await login('admin@adm.com', 'Admin123').expect(200)).body.accessToken;

    for (const [name, email] of [
      ['Ana Silva', 'ana@empresa.com'],
      ['bruno costa', 'bruno@outra.com'],
      ['Carla Cem', 'carla%cem@empresa.com'],
      ['Diego Souza', 'diego_souza@empresa.com'],
    ]) {
      const res = await asAdmin(http().post('/api/v1/users'))
        .send({ name, email, password: 'Senha123' })
        .expect(201);
      ids[email] = res.body.id;
    }
  });

  afterAll(() => app.close());

  describe('busca e ordenação', () => {
    it('busca por nome, sem diferenciar maiúsculas', async () => {
      expect(names(await list('search=ANA').expect(200))).toEqual(['Ana Silva']);
    });

    it('busca por e-mail', async () => {
      const res = await list('search=@empresa.com&sortBy=name&order=asc').expect(200);
      expect(names(res)).toEqual(['Ana Silva', 'Carla Cem', 'Diego Souza']);
    });

    it('% e _ digitados são procurados literalmente (não viram curingas do SQL)', async () => {
      // (nomes não aceitam % ou _, mas e-mails sim — e a busca também olha o e-mail)
      expect(names(await list('search=%25').expect(200))).toEqual(['Carla Cem']);
      expect(names(await list('search=_').expect(200))).toEqual(['Diego Souza']);
    });

    it('ordena por nome asc/desc', async () => {
      const asc = names(await list('sortBy=name&order=asc').expect(200));
      expect(asc).toEqual(
        [...asc].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
      );
      expect(names(await list('sortBy=name&order=desc').expect(200))).toEqual([...asc].reverse());
    });

    it('paginação com ordenação estável', async () => {
      const page1 = names(await list('sortBy=email&order=asc&limit=2&page=1').expect(200));
      const page2 = names(await list('sortBy=email&order=asc&limit=2&page=2').expect(200));
      const all = names(await list('sortBy=email&order=asc&limit=100').expect(200));
      expect([...page1, ...page2]).toEqual(all.slice(0, 4));
    });

    it('campo de ordenação inválido -> 400 traduzido com os valores aceitos', async () => {
      const res = await list('sortBy=password').set('Accept-Language', 'pt-BR').expect(400);
      expect(res.body.errors).toEqual([
        {
          field: 'sortBy',
          code: 'validation.isIn',
          message: 'ordenação deve ser um destes valores: createdAt, name, email',
        },
      ]);
    });
  });

  describe('soft delete e restauração', () => {
    let anaToken: string;

    it('excluir: some das consultas, as sessões caem na hora e o login para de funcionar', async () => {
      anaToken = (await login('ana@empresa.com').expect(200)).body.accessToken;

      await asAdmin(http().delete(`/api/v1/users/${ids['ana@empresa.com']}`)).expect(204);

      await http().get('/api/v1/users/me').set('Authorization', `Bearer ${anaToken}`).expect(401);
      await login('ana@empresa.com').expect(401);
      await asAdmin(http().get(`/api/v1/users/${ids['ana@empresa.com']}`)).expect(404);
      expect(names(await list('search=ana').expect(200))).toEqual([]);
    });

    it('?deleted=true lista só os excluídos, com a data da exclusão', async () => {
      const res = await list('deleted=true').expect(200);
      expect(names(res)).toEqual(['Ana Silva']);
      expect(res.body.data[0].deletedAt).toEqual(expect.any(String));
    });

    it('o e-mail de uma conta excluída pode ser cadastrado de novo', async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ name: 'Ana Nova', email: 'ana@empresa.com', password: 'Senha123' })
        .expect(201);
    });

    it('restaurar falha com 409 se outra conta está usando o e-mail', async () => {
      const res = await asAdmin(
        http().patch(`/api/v1/users/${ids['ana@empresa.com']}/restore`),
      ).expect(409);
      expect(res.body.code).toBe('users.emailTaken');
    });

    it('com o e-mail livre, restaura e a pessoa volta a logar (sessões antigas continuam encerradas)', async () => {
      const novaAna = (await list('search=Ana Nova').expect(200)).body.data[0].id as string;
      await asAdmin(http().delete(`/api/v1/users/${novaAna}`)).expect(204);

      const res = await asAdmin(
        http().patch(`/api/v1/users/${ids['ana@empresa.com']}/restore`),
      ).expect(200);

      expect(res.body).toMatchObject({ name: 'Ana Silva', deletedAt: null });
      await login('ana@empresa.com').expect(200);
      await http().get('/api/v1/users/me').set('Authorization', `Bearer ${anaToken}`).expect(401);
    });

    it('restaurar quem não está excluído -> 404', () =>
      asAdmin(http().patch(`/api/v1/users/${ids['bruno@outra.com']}/restore`)).expect(404));
  });

  it('desativar um usuário derruba as sessões dele na hora', async () => {
    const token = (await login('bruno@outra.com').expect(200)).body.accessToken;

    await asAdmin(http().patch(`/api/v1/users/${ids['bruno@outra.com']}`))
      .send({ isActive: false })
      .expect(200);

    await http().get('/api/v1/users/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  describe('trilha de auditoria', () => {
    const audit = (query = '') => asAdmin(http().get(`/api/v1/audit-logs?limit=100&${query}`));

    it('registra as ações de admin com autor, alvo, IP e requestId', async () => {
      const res = await audit(`targetId=${ids['ana@empresa.com']}`).expect(200);
      const actions = (res.body.data as { action: string }[]).map((l) => l.action);

      // mais recente primeiro
      expect(actions).toEqual(['user.restored', 'user.deleted', 'user.created']);
      expect(res.body.data[0]).toMatchObject({
        actorId: adminId,
        targetType: 'user',
        targetId: ids['ana@empresa.com'],
        ip: expect.any(String),
        requestId: expect.any(String),
      });
    });

    it('registra quais campos mudaram (de/para)', async () => {
      const res = await audit(`action=user.updated&targetId=${ids['bruno@outra.com']}`).expect(200);
      expect(res.body.data[0].metadata).toEqual({
        changes: { isActive: { from: true, to: false } },
      });
    });

    it('registra eventos de segurança, como login com falha (sem senha nos dados)', async () => {
      await login('diego_souza@empresa.com', 'SenhaErrada1').expect(401);

      const res = await audit('action=auth.login_failed').expect(200);
      expect(res.body.data[0]).toMatchObject({
        actorId: ids['diego_souza@empresa.com'],
        metadata: { email: 'diego_souza@empresa.com', reason: 'wrong_password' },
      });
      expect(JSON.stringify(res.body)).not.toContain('SenhaErrada1');
    });

    it('filtra por autor', async () => {
      const res = await audit(`actorId=${adminId}&action=user.deleted`).expect(200);
      expect(res.body.meta.total).toBe(2); // Ana Silva e Ana Nova
    });

    it('só admin consulta a auditoria', async () => {
      const diego = (await login('diego_souza@empresa.com').expect(200)).body.accessToken;
      await http().get('/api/v1/audit-logs').set('Authorization', `Bearer ${diego}`).expect(403);
    });
  });

  describe('conta criada pelo admin (convite)', () => {
    const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
    let inviteUrl: string;
    let invitedId: string;

    afterEach(() => jest.restoreAllMocks());

    it('sem senha: a pessoa recebe o convite com o link para criar a senha', async () => {
      const mail = jest.spyOn(app.get(MailService), 'sendAccountCreated');
      const res = await asAdmin(http().post('/api/v1/users'))
        .send({ name: 'Convidada', email: 'convidada@empresa.com' })
        .expect(201);
      invitedId = res.body.id;

      expect(res.body.emailVerifiedAt).toEqual(expect.any(String));
      expect(mail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'convidada@empresa.com' }),
        { url: expect.stringContaining('/reset-password?token='), expiresInDays: 7 },
      );
      inviteUrl = mail.mock.calls[0][1]!.url;
      // sem senha ainda: login não funciona
      await login('convidada@empresa.com').expect(401);
    });

    it('o link do convite cria a senha (sem e-mail de "senha alterada") e vale uma vez só', async () => {
      const changed = jest.spyOn(app.get(MailService), 'sendPasswordChanged');
      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: tokenOf(inviteUrl), password: 'MinhaSenha1' })
        .expect(200);

      expect(changed).not.toHaveBeenCalled(); // é a 1ª senha, não uma troca
      await login('convidada@empresa.com', 'MinhaSenha1').expect(200);
      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: tokenOf(inviteUrl), password: 'OutraSenha1' })
        .expect(400);
    });

    it('reenviar convite para quem já tem senha -> 400', async () => {
      const res = await asAdmin(http().post(`/api/v1/users/${invitedId}/invite`)).expect(400);
      expect(res.body.code).toBe('users.alreadyHasPassword');
    });

    it('reenviar convite para quem ainda não criou a senha manda um link novo', async () => {
      const created = await asAdmin(http().post('/api/v1/users'))
        .send({ name: 'Atrasada', email: 'atrasada@empresa.com' })
        .expect(201);
      const mail = jest.spyOn(app.get(MailService), 'sendAccountCreated');

      await asAdmin(http().post(`/api/v1/users/${created.body.id}/invite`)).expect(204);
      expect(mail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'atrasada@empresa.com' }),
        expect.objectContaining({ url: expect.any(String) }),
      );
    });

    it('com senha definida pelo admin: só o aviso, sem link e sem a senha', async () => {
      const mail = jest.spyOn(app.get(MailService), 'sendAccountCreated');
      await asAdmin(http().post('/api/v1/users'))
        .send({ name: 'Com Senha', email: 'comsenha@empresa.com', password: 'Senha123' })
        .expect(201);

      expect(mail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'comsenha@empresa.com' }),
        null,
      );
      await login('comsenha@empresa.com').expect(200);
    });

    it('só quem tem users:create convida', async () => {
      await http().post(`/api/v1/users/${invitedId}/invite`).expect(401);
    });
  });
});
