import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

/**
 * Limites baixos SÓ neste arquivo (o setup-env.ts usa limites altos para os demais testes).
 * Os módulos da aplicação são importados depois de ajustar o env, dentro do beforeAll.
 */
Object.assign(process.env, {
  RATE_LIMIT_GLOBAL_LIMIT: '30',
  RATE_LIMIT_AUTH_IP_LIMIT: '8',
  RATE_LIMIT_AUTH_EMAIL_LIMIT: '3',
});

describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const login = (email: string) =>
    http()
      .post('/api/v1/auth/login')
      .set('Accept-Language', 'pt-BR')
      .send({ email, password: 'SenhaErrada1' });

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
  });

  afterAll(() => app.close());

  it('por e-mail: a 4ª tentativa no mesmo e-mail é bloqueada (limite 3), com mensagem traduzida', async () => {
    for (let i = 0; i < 3; i++) await login('vitima@test.com').expect(401);

    const res = await login('vitima@test.com').expect(429);
    expect(res.body).toEqual({
      statusCode: 429,
      requestId: expect.any(String),
      code: 'errors.tooManyRequests',
      message: expect.stringMatching(/^Muitas tentativas\. Tente novamente em \d+ segundos\.$/),
    });
    expect(Number(res.headers['retry-after-auth-email'])).toBeGreaterThan(0);
  });

  it('por e-mail: o e-mail é normalizado (maiúsculas/espaços não burlam o limite)', () =>
    login('  VITIMA@test.com ').expect(429));

  it('por e-mail: outro e-mail continua liberado', () => login('outra@test.com').expect(401));

  it('por IP: trocando de e-mail a cada tentativa, o limite por IP (8) segura', async () => {
    // Este IP já fez 6 requisições a /login nos testes acima (3 + 1 + 1 + 1).
    // As bloqueadas também contam: ser barrado não devolve tentativas ao atacante.
    // Restam 2 até o limite de 8 — mesmo usando um e-mail novo a cada vez.
    for (let i = 0; i < 2; i++) await login(`tentativa${i}@test.com`).expect(401);

    const res = await login('mais-uma@test.com').expect(429);
    expect(res.headers['retry-after-auth-ip']).toBeDefined();
  });

  it('o limite é por rota: "esqueci a senha" tem contador próprio', () =>
    http().post('/api/v1/auth/password/forgot').send({ email: 'x@test.com' }).expect(200));

  it('limite global (30/min por IP) vale para qualquer rota, inclusive públicas', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await http().get('/api/health')).status);

    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('os contadores ficam no banco (compartilhados entre instâncias/Lambdas)', async () => {
    const { DataSource } = await import('typeorm');
    const rows: { key: string; hits: number }[] = await app
      .get(DataSource)
      .query('SELECT "key", "hits" FROM "rate_limits"');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => Number(r.hits) > 1)).toBe(true);
  });
});
