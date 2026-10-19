const toBool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === ''
    ? fallback
    : ['true', '1', 'yes'].includes(value.toLowerCase());

const toInt = (value: string | undefined, fallback: number): number =>
  value === undefined || value === '' ? fallback : parseInt(value, 10);

const toList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export type DatabaseType = 'postgres' | 'sqljs';
export type MailTransportType = 'smtp' | 'ses' | 'json';

export default () => {
  const env = process.env.NODE_ENV ?? 'development';

  return {
    app: {
      name: process.env.APP_NAME ?? 'NestJS Base API',
      env,
      port: toInt(process.env.PORT, 3000),
      /** fatal | error | warn | info | debug | trace | silent */
      logLevel: process.env.LOG_LEVEL ?? 'info',
      url: process.env.APP_URL ?? 'http://localhost:3000',
      frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
      fallbackLanguage: process.env.FALLBACK_LANGUAGE ?? 'en',
      /** Nº de proxies confiáveis na frente da API (0 = nenhum; na Lambda use 0). */
      trustProxy: toInt(process.env.TRUST_PROXY, 0),
      corsOrigin:
        !process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*'
          ? '*'
          : process.env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    },
    security: {
      /** Chave para cifrar dados sensíveis no banco (segredos 2FA). Obrigatória em produção. */
      encryptionKey: process.env.ENCRYPTION_KEY || undefined,
      /** Custo do bcrypt (cada +1 dobra o tempo). 12 em produção; os testes usam 4. */
      bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 12),
      /**
       * Ações sensíveis (excluir conta, trocar e-mail, ativar 2FA) pedem a senha. Contas sem senha
       * (só login social) precisam ter entrado há no máximo este tempo (segundos).
       */
      reauthWindow: toInt(process.env.REAUTH_WINDOW_SECONDS, 600),
    },
    session: {
      /** Idade máxima de uma sessão, mesmo usada todo dia (depois disso, login de novo). */
      maxAgeDays: toInt(process.env.SESSION_MAX_AGE_DAYS, 90),
    },
    /** Job de manutenção (Lambda `maintenance` ou `npm run maintenance`). */
    maintenance: {
      /** Sessões encerradas/expiradas ficam este tempo (histórico e detecção de dispositivo novo). */
      sessionsRetentionDays: toInt(process.env.SESSIONS_RETENTION_DAYS, 30),
      /** Trilha de auditoria: registros mais antigos são apagados. 0 = guardar para sempre. */
      auditRetentionDays: toInt(process.env.AUDIT_RETENTION_DAYS, 365),
      /** Conta excluída: depois deste prazo os dados pessoais são apagados (anonimização). */
      accountPurgeAfterDays: toInt(process.env.ACCOUNT_PURGE_AFTER_DAYS, 30),
    },
    /** Arquivos: s3 em produção; local (disco) em desenvolvimento e testes. */
    storage: {
      driver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
      local: { dir: process.env.STORAGE_LOCAL_DIR ?? 'tmp/uploads' },
      s3: {
        bucket: process.env.STORAGE_S3_BUCKET || undefined,
        region: process.env.STORAGE_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
      },
      /** Base das URLs públicas (ex.: um CloudFront). Padrão: a URL do próprio bucket. */
      publicUrl: process.env.STORAGE_PUBLIC_URL || undefined,
      uploadExpiresIn: toInt(process.env.STORAGE_UPLOAD_EXPIRES_IN, 600),
      downloadExpiresIn: toInt(process.env.STORAGE_DOWNLOAD_EXPIRES_IN, 300),
      /** Limpeza automática de uploads abandonados (job agendado). */
      cleanup: {
        afterHours: toInt(process.env.FILES_CLEANUP_AFTER_HOURS, 24),
        batchSize: toInt(process.env.FILES_CLEANUP_BATCH_SIZE, 500),
      },
      /** Uploads ainda não concluídos por usuário (barra abuso de armazenamento). */
      maxPendingPerUser: toInt(process.env.FILES_MAX_PENDING_PER_USER, 20),
    },
    /** Login social: client IDs do SEU app em cada provedor (web, iOS, Android...). Vazio = desligado. */
    social: {
      google: { clientIds: toList(process.env.GOOGLE_CLIENT_IDS) },
      apple: { clientIds: toList(process.env.APPLE_CLIENT_IDS) },
    },
    auth: {
      /** Rotas autenticadas exigem e-mail confirmado (exceto @AllowUnverified). */
      requireEmailVerification: toBool(process.env.REQUIRE_EMAIL_VERIFICATION, true),
    },
    /** Limites de requisição (janelas em segundos). Contadores ficam na tabela rate_limits. */
    rateLimit: {
      enabled: toBool(process.env.RATE_LIMIT_ENABLED, true),
      global: {
        limit: toInt(process.env.RATE_LIMIT_GLOBAL_LIMIT, 100),
        ttl: toInt(process.env.RATE_LIMIT_GLOBAL_TTL, 60),
      },
      authIp: {
        limit: toInt(process.env.RATE_LIMIT_AUTH_IP_LIMIT, 20),
        ttl: toInt(process.env.RATE_LIMIT_AUTH_TTL, 900),
      },
      authEmail: {
        limit: toInt(process.env.RATE_LIMIT_AUTH_EMAIL_LIMIT, 5),
        ttl: toInt(process.env.RATE_LIMIT_AUTH_TTL, 900),
      },
    },
    swagger: {
      enabled: toBool(process.env.SWAGGER_ENABLED, env !== 'production'),
    },
    database: {
      type: (process.env.DB_TYPE ?? 'postgres') as DatabaseType,
      host: process.env.DB_HOST ?? 'localhost',
      port: toInt(process.env.DB_PORT, 5432),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      name: process.env.DB_NAME ?? 'nestjs_base',
      ssl: toBool(process.env.DB_SSL, false),
      /** Confere o certificado do banco (padrão). Para o RDS, informe o bundle da AWS em DB_SSL_CA_FILE. */
      sslRejectUnauthorized: toBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
      sslCaFile: process.env.DB_SSL_CA_FILE || undefined,
      synchronize: toBool(process.env.DB_SYNCHRONIZE, false),
      migrationsRun: toBool(process.env.DB_MIGRATIONS_RUN, false),
      logging: toBool(process.env.DB_LOGGING, false),
      poolMax: toInt(process.env.DB_POOL_MAX, 10),
      /**
       * Tentativas de conectar ao subir. Na Lambda são poucas: o API Gateway desiste em ~30 s,
       * então é melhor falhar rápido (com o erro no log) do que estourar o tempo sem explicação.
       */
      connectRetries: toInt(
        process.env.DB_CONNECT_RETRIES,
        process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 10,
      ),
      /** Tempo máximo para abrir uma conexão (ms). Banco inalcançável falha em vez de travar. */
      connectTimeoutMs: toInt(process.env.DB_CONNECT_TIMEOUT_MS, 5000),
    },
    jwt: {
      secret: process.env.JWT_SECRET as string,
      expiresIn: toInt(process.env.JWT_EXPIRES_IN, 900),
      refreshExpiresIn: toInt(process.env.REFRESH_TOKEN_EXPIRES_IN, 2592000),
      resetPasswordExpiresIn: toInt(process.env.RESET_PASSWORD_EXPIRES_IN, 900),
      /** Validade (s) do link de convite para criar a senha (conta criada por admin). 7 dias */
      inviteExpiresIn: toInt(process.env.INVITE_EXPIRES_IN, 604800),
      emailVerificationExpiresIn: toInt(process.env.EMAIL_VERIFICATION_EXPIRES_IN, 86400),
    },
    mail: {
      transport: (process.env.MAIL_TRANSPORT ?? 'json') as MailTransportType,
      from: process.env.MAIL_FROM ?? 'NestJS Base <no-reply@example.com>',
      supportEmail: process.env.MAIL_SUPPORT_EMAIL ?? 'suporte@example.com',
      /** sync = envia durante a requisição; sqs = coloca na fila e o worker envia */
      delivery: (process.env.MAIL_DELIVERY ?? 'sync') as 'sync' | 'sqs',
      queueUrl: process.env.MAIL_QUEUE_URL || undefined,
      /** Fuso usado nas datas dentro dos e-mails */
      timezone: process.env.MAIL_TIMEZONE ?? 'America/Sao_Paulo',
      smtp: {
        host: process.env.SMTP_HOST ?? 'localhost',
        port: toInt(process.env.SMTP_PORT, 1025),
        secure: toBool(process.env.SMTP_SECURE, false),
        user: process.env.SMTP_USER || undefined,
        pass: process.env.SMTP_PASS || undefined,
      },
      ses: {
        region: process.env.SES_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
      },
    },
  };
};
