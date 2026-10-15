import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/mail/mail.service';

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
});
