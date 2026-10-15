import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { UsersService } from '../src/users/users.service';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

describe('Meus dispositivos (e2e)', () => {
  let app: INestApplication<App>;
  let desktop: Tokens;
  let phone: Tokens;

  const http = () => request(app.getHttpServer());
  const login = async (userAgent: string, email = 'ana@test.com'): Promise<Tokens> =>
    (
      await http()
        .post('/api/v1/auth/login')
        .set('User-Agent', userAgent)
        .send({ email, password: 'Senha123' })
        .expect(200)
    ).body;
  const as = (tokens: Tokens, req: request.Test) =>
    req.set('Authorization', `Bearer ${tokens.accessToken}`);
  const mySessions = async (tokens: Tokens) =>
    (await as(tokens, http().get('/api/v1/users/me/sessions')).expect(200)).body as {
      id: string;
      userAgent: string;
      current: boolean;
      ip: string;
      lastUsedAt: string;
    }[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();

    const users = app.get(UsersService);
    for (const email of ['ana@test.com', 'bia@test.com']) {
      await users.create({ name: 'X', email, password: 'Senha123' }, { emailVerified: true });
    }
    desktop = await login(CHROME);
    phone = await login(IPHONE);
  });

  afterAll(() => app.close());

  it('lista as sessões ativas com navegador, IP e qual é a atual', async () => {
    const sessions = await mySessions(desktop);

    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.userAgent).sort()).toEqual([CHROME, IPHONE].sort());
    expect(sessions.find((s) => s.current)?.userAgent).toBe(CHROME);
    expect(sessions.every((s) => s.ip && s.lastUsedAt)).toBe(true);
  });

  it('do celular, a sessão atual é a do celular', async () => {
    expect((await mySessions(phone)).find((s) => s.current)?.userAgent).toBe(IPHONE);
  });

  it('o refresh atualiza o "último uso" da sessão', async () => {
    const before = (await mySessions(phone)).find((s) => s.current)!.lastUsedAt;
    await new Promise((r) => setTimeout(r, 20));

    phone = (
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: phone.refreshToken })
        .expect(200)
    ).body;

    const after = (await mySessions(phone)).find((s) => s.current)!.lastUsedAt;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('encerrar uma sessão (o celular perdido) derruba o acesso dela na hora', async () => {
    const phoneSession = (await mySessions(desktop)).find((s) => s.userAgent === IPHONE)!;

    await as(desktop, http().delete(`/api/v1/users/me/sessions/${phoneSession.id}`)).expect(204);

    await as(phone, http().get('/api/v1/users/me')).expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: phone.refreshToken })
      .expect(401);
    expect((await mySessions(desktop)).map((s) => s.userAgent)).toEqual([CHROME]);
  });

  it.each([
    ['inexistente', '3f1c2b9e-8a4d-4f6e-9b1a-2c3d4e5f6a7b'],
    ['com id inválido', 'abc'],
  ])('sessão %s -> 404', async (_, id) => {
    const res = await as(desktop, http().delete(`/api/v1/users/me/sessions/${id}`)).expect(404);
    expect(res.body.code).toBe('sessions.notFound');
  });

  it('não dá para encerrar a sessão de OUTRO usuário (404, sem revelar que existe)', async () => {
    const bia = await login(CHROME, 'bia@test.com');
    const biaSession = (await mySessions(bia))[0];

    await as(desktop, http().delete(`/api/v1/users/me/sessions/${biaSession.id}`)).expect(404);
    await as(bia, http().get('/api/v1/users/me')).expect(200);
  });

  it('"sair de todos os outros dispositivos" mantém só a sessão atual', async () => {
    const tablet = await login('Tablet');
    const tv = await login('SmartTV');

    await as(desktop, http().delete('/api/v1/users/me/sessions')).expect(204);

    await as(tablet, http().get('/api/v1/users/me')).expect(401);
    await as(tv, http().get('/api/v1/users/me')).expect(401);
    await as(desktop, http().get('/api/v1/users/me')).expect(200);
    expect((await mySessions(desktop)).map((s) => s.current)).toEqual([true]);
  });

  it('exige autenticação', () => http().get('/api/v1/users/me/sessions').expect(401));
});
