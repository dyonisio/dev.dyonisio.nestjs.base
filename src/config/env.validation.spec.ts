import 'reflect-metadata';
import { validateEnv } from './env.validation';

const SECRET = 'x'.repeat(40);

const production = {
  NODE_ENV: 'production',
  JWT_SECRET: SECRET,
  DB_HOST: 'db.aws',
  DB_NAME: 'app',
  DB_USERNAME: 'app',
  DB_PASSWORD: 'secret',
  APP_URL: 'https://api.app.com',
  FRONTEND_URL: 'https://app.com',
  CORS_ORIGIN: 'https://app.com',
  MAIL_TRANSPORT: 'ses',
  MAIL_FROM: 'App <no-reply@app.com>',
  ENCRYPTION_KEY: 'k'.repeat(44),
  STORAGE_DRIVER: 's3',
  STORAGE_S3_BUCKET: 'app-uploads',
  TRUST_PROXY: '1',
};

describe('validateEnv', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('na Lambda, TRUST_PROXY não é necessária (o API Gateway entrega o IP real)', () => {
    expect(() =>
      validateEnv({ ...production, TRUST_PROXY: undefined, AWS_LAMBDA_FUNCTION_NAME: 'api' }),
    ).not.toThrow();
  });

  it('configurações que enfraquecem a segurança em produção geram aviso (sem impedir)', () => {
    validateEnv({
      ...production,
      RATE_LIMIT_ENABLED: 'false',
      REQUIRE_EMAIL_VERIFICATION: 'false',
      SWAGGER_ENABLED: 'true',
    });
    validateEnv({ ...production, DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false' });
    const warned = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    for (const text of [
      'RATE_LIMIT_ENABLED=false',
      'REQUIRE_EMAIL_VERIFICATION=false',
      'SWAGGER_ENABLED=true',
      'DB_SSL desligado',
      'DB_SSL_REJECT_UNAUTHORIZED=false',
    ]) {
      expect(warned).toContain(text);
    }
  });

  it('em desenvolvimento só exige o JWT_SECRET', () => {
    expect(() => validateEnv({ JWT_SECRET: 'segredo-de-dev-123' })).not.toThrow();
    expect(() => validateEnv({})).toThrow('JWT_SECRET');
  });

  it('aceita uma configuração de produção completa', () => {
    expect(() => validateEnv(production)).not.toThrow();
  });

  it.each(['DB_HOST', 'DB_PASSWORD', 'FRONTEND_URL', 'CORS_ORIGIN', 'MAIL_FROM', 'ENCRYPTION_KEY'])(
    'em produção, falta de %s impede a aplicação de subir',
    (key) => {
      expect(() => validateEnv({ ...production, [key]: undefined })).toThrow(
        `${key} é obrigatória em produção`,
      );
    },
  );

  it.each([
    [{ JWT_SECRET: 'curto-demais-1234567' }, 'JWT_SECRET deve ter pelo menos 32'],
    [{ ENCRYPTION_KEY: 'curta' }, 'ENCRYPTION_KEY deve ter pelo menos 32'],
    [{ DB_TYPE: 'sqljs' }, 'DB_TYPE=sqljs'],
    [{ DB_SYNCHRONIZE: 'true' }, 'DB_SYNCHRONIZE=true'],
    [{ MAIL_TRANSPORT: 'json' }, 'MAIL_TRANSPORT=json'],
    [{ STORAGE_DRIVER: 'local' }, 'STORAGE_DRIVER deve ser s3'],
    [{ STORAGE_S3_BUCKET: undefined }, 'STORAGE_S3_BUCKET é obrigatória'],
    [{ CORS_ORIGIN: '*' }, 'CORS_ORIGIN=* não é permitido'],
    [{ CORS_ORIGIN: 'https://app.com,*' }, 'CORS_ORIGIN=* não é permitido'],
    [{ FRONTEND_URL: 'http://localhost:5173' }, 'FRONTEND_URL aponta para localhost'],
    [{ APP_URL: 'http://127.0.0.1:3000' }, 'APP_URL aponta para localhost'],
    [
      { JWT_SECRET: 'troque-este-segredo-por-um-valor-longo-e-aleatorio' },
      'JWT_SECRET está com o valor de exemplo',
    ],
    [{ ENCRYPTION_KEY: SECRET }, 'ENCRYPTION_KEY deve ser diferente de JWT_SECRET'],
    [{ TRUST_PROXY: undefined }, 'TRUST_PROXY é obrigatória fora da Lambda'],
  ])('em produção, rejeita configuração insegura %o', (override, message) => {
    expect(() => validateEnv({ ...production, ...override })).toThrow(message);
  });
});
