import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { MailService } from '../src/mail/mail.service';
import { UsersService } from '../src/users/users.service';

/** E-mails saem no idioma SALVO do usuário — não no da requisição que os disparou. */
describe('Idioma dos e-mails (e2e)', () => {
  let app: INestApplication<App>;
  let mail: MailService;

  const http = () => request(app.getHttpServer());
  const register = (email: string, lang: string, body: object = {}) =>
    http()
      .post('/api/v1/auth/register')
      .set('Accept-Language', lang)
      .send({ name: 'X', email, password: 'Senha123', ...body });
  /** Último e-mail "enviado": idioma e assunto. */
  const lastMail = (spy: jest.SpyInstance) => {
    const options = spy.mock.calls.at(-1)[0];
    return { lang: options.lang, subject: options.subject, to: options.to };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
    mail = app.get(MailService);
  });

  afterAll(() => app.close());
  afterEach(() => jest.restoreAllMocks());

  it('no cadastro, o idioma vem do Accept-Language e o e-mail de confirmação sai nele', async () => {
    const send = jest.spyOn(mail, 'send');

    const res = await register('john@test.com', 'en-US').expect(201);

    expect(res.body.user.locale).toBe('en');
    expect(lastMail(send)).toEqual({
      lang: 'en',
      subject: 'Confirm your email',
      to: 'john@test.com',
    });
  });

  it('o campo locale enviado no cadastro tem prioridade sobre o header', async () => {
    const send = jest.spyOn(mail, 'send');

    const res = await register('maria@test.com', 'en', { locale: 'pt-BR' }).expect(201);

    expect(res.body.user.locale).toBe('pt-BR');
    expect(lastMail(send)).toMatchObject({ lang: 'pt-BR', subject: 'Confirme seu e-mail' });
  });

  it('idioma não suportado -> 400 com os valores aceitos', async () => {
    const res = await register('x@test.com', 'pt-BR', { locale: 'fr' }).expect(400);
    expect(res.body.errors[0]).toMatchObject({
      field: 'locale',
      code: 'validation.isIn',
      message: 'idioma deve ser um destes valores: en, pt-BR',
    });
  });

  it('o e-mail usa o idioma do usuário mesmo quando a requisição vem em outro idioma', async () => {
    // Maria (pt-BR) pede "esqueci a senha" de um computador em inglês
    const send = jest.spyOn(mail, 'send');

    await http()
      .post('/api/v1/auth/password/forgot')
      .set('Accept-Language', 'en')
      .send({ email: 'maria@test.com' })
      .expect(200);

    expect(lastMail(send)).toMatchObject({ lang: 'pt-BR', subject: 'Redefinição de senha' });
  });

  it('o usuário pode trocar o idioma no perfil e os próximos e-mails seguem o novo idioma', async () => {
    const token = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'maria@test.com', password: 'Senha123' })
        .expect(200)
    ).body.accessToken;

    const res = await http()
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'en' })
      .expect(200);
    expect(res.body.locale).toBe('en');

    const send = jest.spyOn(mail, 'send');
    await http().post('/api/v1/auth/password/forgot').send({ email: 'maria@test.com' }).expect(200);
    expect(lastMail(send)).toMatchObject({ lang: 'en', subject: 'Reset your password' });
  });

  describe('conta sem idioma salvo (ex.: o admin criado pelo seed)', () => {
    const noLocale = (email: string) =>
      app
        .get(UsersService)
        .create(
          { name: 'Sem Idioma', email, password: 'Senha123', role: Role.USER },
          { emailVerified: true },
        );
    const login = (email: string, lang?: string) => {
      const req = http().post('/api/v1/auth/login');
      if (lang) req.set('Accept-Language', lang);
      return req.send({ email, password: 'Senha123' });
    };

    it('e-mails disparados pela pessoa saem no idioma em que ela está usando o site', async () => {
      await noLocale('semidioma1@test.com');
      const send = jest.spyOn(mail, 'send');

      await http()
        .post('/api/v1/auth/password/forgot')
        .set('Accept-Language', 'pt-BR')
        .send({ email: 'semidioma1@test.com' })
        .expect(200);

      expect(lastMail(send)).toMatchObject({ lang: 'pt-BR', subject: 'Redefinição de senha' });
    });

    it('no login, a conta adota o idioma do site (e os próximos e-mails seguem ele)', async () => {
      await noLocale('semidioma2@test.com');

      const res = await login('semidioma2@test.com', 'pt-BR').expect(200);

      expect(res.body.user.locale).toBe('pt-BR');
      const me = await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body.locale).toBe('pt-BR');
    });

    it('sem Accept-Language, não grava o idioma padrão como se fosse escolha da pessoa', async () => {
      await noLocale('semidioma3@test.com');

      const res = await login('semidioma3@test.com').expect(200);

      expect(res.body.user.locale).toBeNull();
    });

    it('um idioma já escolhido nunca é sobrescrito pelo do login', async () => {
      // escolheu pt-BR no cadastro e entra de um computador em inglês
      await register('escolheu@test.com', 'pt-BR', { locale: 'pt-BR' }).expect(201);
      const res = await http()
        .post('/api/v1/auth/login')
        .set('Accept-Language', 'en')
        .send({ email: 'escolheu@test.com', password: 'Senha123' })
        .expect(200);

      expect(res.body.user.locale).toBe('pt-BR');
    });
  });
});
