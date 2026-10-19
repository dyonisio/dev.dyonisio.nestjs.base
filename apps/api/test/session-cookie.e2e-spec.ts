import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { UsersService } from '../src/users/users.service';

/**
 * Refresh token em cookie httpOnly (front web, cabeçalho X-Session-Cookie: 1).
 * Sem o cabeçalho, o comportamento antigo continua (token no corpo).
 */
describe('Sessão em cookie httpOnly (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const COOKIE_MODE = { 'X-Session-Cookie': '1' };

  /** O cookie "refresh=..." da resposta (só o par nome=valor) e os atributos dele. */
  function refreshCookie(res: request.Response) {
    const raw = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('refresh='));
    return raw ? { pair: raw.split(';')[0]!, attrs: raw.toLowerCase() } : null;
  }

  const login = (headers: Record<string, string> = {}) =>
    http()
      .post('/api/v1/auth/login')
      .set(headers)
      .send({ email: 'cookie@test.com', password: 'Senha123' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
    await app
      .get(UsersService)
      .create(
        { name: 'Cookie Teste', email: 'cookie@test.com', password: 'Senha123', role: Role.USER },
        { emailVerified: true },
      );
  });

  afterAll(() => app.close());

  it('login no modo cookie: o refresh token vai num cookie httpOnly e sai do corpo', async () => {
    const res = await login(COOKIE_MODE).expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = refreshCookie(res);
    expect(cookie).not.toBeNull();
    expect(cookie!.attrs).toContain('httponly');
    expect(cookie!.attrs).toContain('samesite=strict');
    expect(cookie!.attrs).toContain('path=/api/v1/auth');
  });

  it('refresh pelo cookie troca o par; o cookie antigo (já usado) derruba a sessão', async () => {
    const first = refreshCookie(await login(COOKIE_MODE).expect(200))!.pair;

    const res = await http()
      .post('/api/v1/auth/refresh')
      .set(COOKIE_MODE)
      .set('Cookie', first)
      .send({})
      .expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toBeUndefined();
    const second = refreshCookie(res)!.pair;
    expect(second).not.toBe(first);

    // reuso do token já trocado = roubo: 401, e o cookie é apagado
    const reuse = await http()
      .post('/api/v1/auth/refresh')
      .set(COOKIE_MODE)
      .set('Cookie', first)
      .send({})
      .expect(401);
    expect(refreshCookie(reuse)?.attrs).toMatch(/expires=thu, 01 jan 1970|max-age=0/);
  });

  it('sem o cabeçalho, o cookie é ignorado (outro site não consegue forjar um refresh)', async () => {
    const cookie = refreshCookie(await login(COOKIE_MODE).expect(200))!.pair;

    await http().post('/api/v1/auth/refresh').set('Cookie', cookie).send({}).expect(401);
  });

  it('logout pelo cookie encerra a sessão e apaga o cookie', async () => {
    const res = await login(COOKIE_MODE).expect(200);
    const cookie = refreshCookie(res)!.pair;

    const out = await http()
      .post('/api/v1/auth/logout')
      .set(COOKIE_MODE)
      .set('Cookie', cookie)
      .send({})
      .expect(204);
    expect(refreshCookie(out)?.attrs).toMatch(/expires=thu, 01 jan 1970|max-age=0/);

    // a sessão morreu: o access token dela também
    await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(401);
  });

  it('clientes sem o cabeçalho (mobile) continuam com o token no corpo e sem cookie', async () => {
    const res = await login().expect(200);

    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeNull();
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: res.body.refreshToken })
      .expect(200);
  });

  it('CORS aceita credenciais (o navegador só envia o cookie assim)', async () => {
    const res = await http()
      .options('/api/v1/auth/refresh')
      .set('Origin', 'http://front.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-session-cookie')
      .expect(204);

    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-origin']).toBe('http://front.test');
  });
});
