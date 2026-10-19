// Variáveis para os testes e2e: banco em memória (sql.js) e e-mails sem envio real.
// Definidas antes do ConfigModule carregar — sobrescrevem qualquer valor do .env.
Object.assign(process.env, {
  NODE_ENV: 'test',
  APP_NAME: 'Test App', // fixo: não depende do .env local nem do nome do projeto
  DB_TYPE: 'sqljs',
  DB_LOGGING: 'false',
  JWT_SECRET: 'segredo-de-teste-e2e-com-tamanho-suficiente',
  JWT_EXPIRES_IN: '3600',
  MAIL_TRANSPORT: 'json',
  SWAGGER_ENABLED: 'true',
  LOG_LEVEL: 'silent',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: `tmp/test-uploads/${process.pid}`,
  FRONTEND_URL: 'http://front.test',
  BCRYPT_ROUNDS: '4', // hash rápido nos testes (produção: 12)
  // Limites altos: os testes fazem muitos logins do mesmo IP/e-mail.
  // O comportamento do rate limit é testado em rate-limit.e2e-spec.ts.
  RATE_LIMIT_GLOBAL_LIMIT: '100000',
  RATE_LIMIT_AUTH_IP_LIMIT: '100000',
  RATE_LIMIT_AUTH_EMAIL_LIMIT: '100000',
});
