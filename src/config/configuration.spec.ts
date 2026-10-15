import configuration from './configuration';

describe('configuration', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { JWT_SECRET: 'segredo' };
  });
  afterAll(() => {
    process.env = original;
  });

  it('usa valores padrão seguros quando nada é informado', () => {
    const config = configuration();

    expect(config.app).toMatchObject({ port: 3000, corsOrigin: '*', trustProxy: 0 });
    expect(config.database).toMatchObject({ type: 'postgres', synchronize: false, poolMax: 10 });
    expect(config.jwt).toMatchObject({ expiresIn: 900, refreshExpiresIn: 2592000 });
    expect(config.mail.transport).toBe('json');
    expect(config.auth.requireEmailVerification).toBe(true);
    expect(config.rateLimit).toMatchObject({ enabled: true, authEmail: { limit: 5, ttl: 900 } });
    expect(config.swagger.enabled).toBe(true); // fora de produção
  });

  it('converte números e booleanos do env', () => {
    process.env = {
      ...process.env,
      PORT: '8080',
      DB_SSL: 'TRUE',
      DB_SYNCHRONIZE: '1',
      REQUIRE_EMAIL_VERIFICATION: 'false',
      RATE_LIMIT_ENABLED: 'no',
      SMTP_SECURE: 'yes',
    };
    const config = configuration();

    expect(config.app.port).toBe(8080);
    expect(config.database).toMatchObject({ ssl: true, synchronize: true });
    expect(config.auth.requireEmailVerification).toBe(false);
    expect(config.rateLimit.enabled).toBe(false);
    expect(config.mail.smtp.secure).toBe(true);
  });

  it('variáveis vazias contam como não informadas', () => {
    process.env = { ...process.env, PORT: '', DB_SSL: '', SMTP_USER: '' };
    const config = configuration();

    expect(config.app.port).toBe(3000);
    expect(config.database.ssl).toBe(false);
    expect(config.mail.smtp.user).toBeUndefined();
  });

  it('CORS_ORIGIN com vírgulas vira lista', () => {
    process.env = { ...process.env, CORS_ORIGIN: 'https://a.com, https://b.com' };
    expect(configuration().app.corsOrigin).toEqual(['https://a.com', 'https://b.com']);
  });

  it('Swagger fica desligado por padrão em produção', () => {
    process.env = { ...process.env, NODE_ENV: 'production' };
    expect(configuration().swagger.enabled).toBe(false);
  });

  it('região do SES: SES_REGION > AWS_REGION (Lambda) > us-east-1', () => {
    expect(configuration().mail.ses.region).toBe('us-east-1');
    process.env = { ...process.env, AWS_REGION: 'sa-east-1' };
    expect(configuration().mail.ses.region).toBe('sa-east-1');
    process.env = { ...process.env, SES_REGION: 'eu-west-1' };
    expect(configuration().mail.ses.region).toBe('eu-west-1');
  });
});
