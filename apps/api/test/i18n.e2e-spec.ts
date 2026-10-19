import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { UsersService } from '../src/users/users.service';

describe('Erros localizados (e2e)', () => {
  let app: INestApplication<App>;

  const http = () => request(app.getHttpServer());
  const badLogin = (lang?: string) => {
    const req = http().post('/api/v1/auth/login');
    if (lang) req.set('Accept-Language', lang);
    return req.send({ email: 'ninguem@test.com', password: 'qualquer' }).expect(401);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
  });

  afterAll(() => app.close());

  describe('idioma da requisição (Accept-Language)', () => {
    it('pt-BR', async () => {
      const res = await badLogin('pt-BR');
      expect(res.body).toEqual({
        statusCode: 401,
        requestId: expect.any(String),
        code: 'auth.invalidCredentials',
        message: 'E-mail ou senha inválidos',
      });
      expect(res.headers['content-language']).toBe('pt-BR');
    });

    it('en', async () => {
      const res = await badLogin('en');
      expect(res.body.message).toBe('Invalid email or password');
      expect(res.body.code).toBe('auth.invalidCredentials'); // o código não muda com o idioma
    });

    it('variações regionais caem no idioma base: pt-PT -> pt-BR, en-GB -> en', async () => {
      expect((await badLogin('pt-PT')).body.message).toBe('E-mail ou senha inválidos');
      expect((await badLogin('en-GB')).body.message).toBe('Invalid email or password');
    });

    it('respeita os pesos: "fr, pt-BR;q=0.8, en;q=0.5" -> pt-BR', async () => {
      const res = await badLogin('fr, pt-BR;q=0.8, en;q=0.5');
      expect(res.body.message).toBe('E-mail ou senha inválidos');
    });

    it('sem header ou idioma não suportado -> idioma padrão (FALLBACK_LANGUAGE=en)', async () => {
      expect((await badLogin()).body.message).toBe('Invalid email or password');
      expect((await badLogin('ja')).body.message).toBe('Invalid email or password');
    });
  });

  describe('erros de validação', () => {
    it('traduz cada campo, com o nome do campo e os parâmetros da regra', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .set('Accept-Language', 'pt-BR')
        .send({ name: '', email: 'invalido', password: 'abc', role: 'admin' })
        .expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
        code: 'errors.validation',
        message: 'Erro de validação',
      });
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          {
            field: 'role',
            code: 'validation.whitelistValidation',
            message: 'O campo perfil não é permitido',
          },
          { field: 'name', code: 'validation.isNotEmpty', message: 'nome não pode ficar vazio' },
          {
            field: 'email',
            code: 'validation.isEmail',
            message: 'e-mail deve ser um e-mail válido',
          },
          {
            field: 'password',
            code: 'validation.minLength',
            message: 'senha deve ter pelo menos 8 caracteres',
          },
          {
            field: 'password',
            code: 'validation.strongPassword',
            message: 'senha deve conter ao menos uma letra e um número',
          },
        ]),
      );
    });

    it('mesma validação em inglês', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .set('Accept-Language', 'en')
        .send({ name: 'Jane', email: 'jane@test.com', password: 'abc12' })
        .expect(400);

      expect(res.body.errors).toEqual([
        {
          field: 'password',
          code: 'validation.minLength',
          message: 'password must be at least 8 characters long',
        },
      ]);
    });

    describe('com admin autenticado', () => {
      let adminToken: string;

      beforeAll(async () => {
        await app
          .get(UsersService)
          .create(
            { name: 'Admin', email: 'admin-i18n@test.com', password: 'Admin123', role: Role.ADMIN },
            { emailVerified: true },
          );
        const res = await http()
          .post('/api/v1/auth/login')
          .send({ email: 'admin-i18n@test.com', password: 'Admin123' })
          .expect(200);
        adminToken = res.body.accessToken;
      });

      it('query params: Max com o limite e IsEnum com os valores permitidos', async () => {
        const res = await http()
          .get('/api/v1/users?limit=500&role=chefe')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('Accept-Language', 'pt-BR')
          .expect(400);

        expect(res.body.errors).toEqual(
          expect.arrayContaining([
            {
              field: 'limit',
              code: 'validation.max',
              message: 'limite deve ser menor ou igual a 100',
            },
            {
              field: 'role',
              code: 'validation.isEnum',
              message: 'perfil deve ser um destes valores: admin, manager, user',
            },
          ]),
        );
      });

      it('id que não é UUID', async () => {
        const res = await http()
          .get('/api/v1/users/abc')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('Accept-Language', 'pt-BR')
          .expect(400);
        expect(res.body).toEqual({
          statusCode: 400,
          requestId: expect.any(String),
          code: 'errors.invalidUuid',
          message: 'O id deve ser um UUID válido',
        });
      });

      it('regra de negócio (404) traduzida', async () => {
        const res = await http()
          .get('/api/v1/users/3f1c2b9e-8a4d-4f6e-9b1a-2c3d4e5f6a7b')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('Accept-Language', 'en')
          .expect(404);
        expect(res.body).toEqual({
          statusCode: 404,
          requestId: expect.any(String),
          code: 'users.notFound',
          message: 'User not found',
        });
      });
    });
  });

  describe('erros gerados fora do nosso código também são traduzidos', () => {
    it('401 do guard (sem token)', async () => {
      const res = await http().get('/api/v1/users/me').set('Accept-Language', 'pt-BR').expect(401);
      expect(res.body).toEqual({
        statusCode: 401,
        requestId: expect.any(String),
        code: 'errors.http.401',
        message: 'Autenticação necessária',
      });
    });

    it('404 de rota inexistente', async () => {
      const res = await http()
        .get('/api/v1/nao-existe')
        .set('Accept-Language', 'pt-BR')
        .expect(404);
      expect(res.body).toEqual({
        statusCode: 404,
        requestId: expect.any(String),
        code: 'errors.http.404',
        message: 'Recurso não encontrado',
      });
    });

    it('JSON malformado', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .set('Accept-Language', 'en')
        .set('Content-Type', 'application/json')
        .send('{"email": ')
        .expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        requestId: expect.any(String),
        code: 'errors.http.400',
        message: 'Bad request',
      });
    });
  });

  it('respostas de sucesso com mensagem também são traduzidas', async () => {
    const res = await http()
      .post('/api/v1/auth/password/forgot')
      .set('Accept-Language', 'pt-BR')
      .send({ email: 'ninguem@test.com' })
      .expect(200);
    expect(res.body.message).toBe(
      'Se o e-mail estiver cadastrado, você receberá as instruções em instantes.',
    );
  });

  it('Swagger documenta o Accept-Language como parâmetro global', async () => {
    const res = await http().get('/docs-json').expect(200);
    const params = res.body.paths['/api/v1/auth/login'].post.parameters;
    expect(params).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Accept-Language', in: 'header' })]),
    );
  });
});
