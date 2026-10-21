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

/** Domínio de uma URL ("https://app.exemplo.com/x" -> "app.exemplo.com"). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'localhost';
  }
}

export default () => {
  const env = process.env.NODE_ENV ?? 'development';

  return {
    app: {
      /** Nome do produto: apps autenticadores (2FA), e-mails e Swagger. O front usa o mesmo (VITE_APP_NAME). */
      name: process.env.APP_NAME ?? 'NestJS Base',
      env,
      port: toInt(process.env.PORT, 3000),
      /** fatal | error | warn | info | debug | trace | silent */
      logLevel: process.env.LOG_LEVEL ?? 'info',
      url: process.env.APP_URL ?? 'http://localhost:3000',
      frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
      /**
       * Ícone da conta nos apps autenticadores que o suportam (parâmetro image do QR do 2FA).
       * Padrão: o ícone publicado pelo front (FRONTEND_URL/icon.png), se o site for HTTPS.
       */
      totpImageUrl:
        process.env.TOTP_IMAGE_URL ??
        (process.env.FRONTEND_URL?.startsWith('https://')
          ? `${process.env.FRONTEND_URL.replace(/\/$/, '')}/icon.png`
          : ''),
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
    /**
     * Passkeys (WebAuthn). A passkey fica presa ao domínio do FRONT (é lá que o navegador a cria):
     * rpId = domínio do FRONTEND_URL; origins = endereços do front aceitos nas respostas.
     */
    webauthn: {
      rpId:
        process.env.WEBAUTHN_RP_ID || hostOf(process.env.FRONTEND_URL ?? 'http://localhost:5173'),
      origins: (process.env.WEBAUTHN_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean),
    },
    /**
     * Pagamentos (exemplo): plataformas ligadas, na ordem de preferência. Vazio = desligado.
     * Cada uma só liga com as chaves dela. Veja docs/PAYMENTS.md.
     */
    payments: {
      providers: (process.env.PAYMENT_PROVIDERS ?? '')
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean),
      /** Endereço público da API, para a URL de webhook que vai na cobrança (InfinitePay). */
      publicApiUrl: process.env.PAYMENTS_PUBLIC_API_URL || process.env.APP_URL || '',
      stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY || undefined,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined,
      },
      infinitepay: { handle: process.env.INFINITEPAY_HANDLE || undefined },
      abacatepay: {
        apiKey: process.env.ABACATEPAY_API_KEY || undefined,
        webhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET || undefined,
      },
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
      /** Envios por pessoa em 24 h (0 = sem limite) */
      maxUploadsPerDay: toInt(process.env.FILES_MAX_UPLOADS_PER_DAY, 50),
      /** Espaço total por pessoa, em bytes, somando os arquivos dela (0 = sem limite). 100 MB */
      maxBytesPerUser: toInt(process.env.FILES_MAX_BYTES_PER_USER, 100 * 1024 * 1024),
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
      /** Validade (s) do link mágico de login. 15 min */
      magicLinkExpiresIn: toInt(process.env.MAGIC_LINK_EXPIRES_IN, 900),
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
