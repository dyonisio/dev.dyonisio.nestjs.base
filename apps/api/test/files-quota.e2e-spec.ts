import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { UsersService } from '../src/users/users.service';

/**
 * Limites de upload por pessoa: envios em 24 h e espaço total. Limites baixos neste arquivo
 * (antes do app subir: a configuração lê o ambiente na inicialização).
 */
describe('Limites de upload (e2e)', () => {
  let app: INestApplication<App>;
  const saved = { ...process.env };

  const http = () => request(app.getHttpServer());
  const createUpload = (token: string, size: number) =>
    http()
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'pt-BR')
      .send({ purpose: 'document', contentType: 'application/pdf', size });

  async function tokenFor(email: string): Promise<string> {
    await app
      .get(UsersService)
      .create(
        { name: 'Pessoa Teste', email, password: 'Senha123', role: Role.USER },
        { emailVerified: true },
      );
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'Senha123' })
      .expect(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      FILES_MAX_UPLOADS_PER_DAY: '3',
      FILES_MAX_BYTES_PER_USER: String(5 * 1024 * 1024), // 5 MB
      FILES_MAX_PENDING_PER_USER: '100',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('passou do número de envios em 24 h -> 429 com o limite na mensagem', async () => {
    const token = await tokenFor('muitos@quota.com');
    for (let i = 0; i < 3; i++) await createUpload(token, 1000).expect(201);

    const res = await createUpload(token, 1000).expect(429);

    expect(res.body.code).toBe('files.dailyLimit');
    expect(res.body.message).toContain('3 envios');
  });

  it('o espaço soma os arquivos da pessoa: o envio que estoura o total é recusado', async () => {
    const token = await tokenFor('espaco@quota.com');
    await createUpload(token, 3 * 1024 * 1024).expect(201); // 3 de 5 MB

    const res = await createUpload(token, 3 * 1024 * 1024).expect(400); // 6 > 5 MB

    expect(res.body.code).toBe('files.storageLimit');
    expect(res.body.message).toContain('5 MB');
    await createUpload(token, 1024 * 1024).expect(201); // 4 de 5 MB: cabe
  });

  it('o limite é por pessoa: os envios de uma não contam para outra', async () => {
    const token = await tokenFor('outra@quota.com');
    await createUpload(token, 1000).expect(201);
  });
});
