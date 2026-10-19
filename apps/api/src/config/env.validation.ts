import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  PORT?: number;

  @IsOptional()
  @IsIn(['postgres', 'sqljs'])
  DB_TYPE?: string;

  @IsString()
  @MinLength(16, { message: 'JWT_SECRET deve ter pelo menos 16 caracteres' })
  JWT_SECRET: string;

  @IsOptional()
  @IsInt()
  JWT_EXPIRES_IN?: number;

  @IsOptional()
  @IsInt()
  REFRESH_TOKEN_EXPIRES_IN?: number;

  @IsOptional()
  @IsIn(['smtp', 'ses', 'json'])
  MAIL_TRANSPORT?: string;

  @IsOptional()
  @IsIn(['sync', 'sqs'])
  MAIL_DELIVERY?: string;
}

/**
 * Em produção não existe "valor padrão aceitável" para estas variáveis:
 * se faltar alguma, a aplicação NÃO sobe (melhor falhar no deploy do que
 * rodar apontando para localhost, com CORS aberto ou sem enviar e-mails).
 */
const REQUIRED_IN_PRODUCTION = [
  'DB_HOST',
  'DB_NAME',
  'DB_USERNAME',
  'DB_PASSWORD',
  'FRONTEND_URL',
  'CORS_ORIGIN',
  'MAIL_TRANSPORT',
  'MAIL_FROM',
  'ENCRYPTION_KEY',
];

/** Valores de exemplo (.env.example / documentação) que nunca podem ir para produção. */
const PLACEHOLDER_SECRETS = ['troque-este-segredo-por-um-valor-longo-e-aleatorio'];

const isLocalUrl = (value: unknown) =>
  typeof value === 'string' && /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)([:/]|$)/i.test(value);

function productionErrors(config: Record<string, unknown>): string[] {
  if (config.NODE_ENV !== 'production') return [];

  const errors = REQUIRED_IN_PRODUCTION.filter((key) => !config[key]).map(
    (key) => `${key} é obrigatória em produção`,
  );
  if (typeof config.CORS_ORIGIN === 'string' && config.CORS_ORIGIN.split(',').includes('*')) {
    errors.push('CORS_ORIGIN=* não é permitido em produção — informe o(s) domínio(s) do front');
  }
  for (const key of ['FRONTEND_URL', 'APP_URL']) {
    if (isLocalUrl(config[key])) errors.push(`${key} aponta para localhost em produção`);
  }
  for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY']) {
    if (PLACEHOLDER_SECRETS.includes(config[key] as string)) {
      errors.push(`${key} está com o valor de exemplo — gere um com: openssl rand -base64 48`);
    }
  }
  if (config.JWT_SECRET && config.JWT_SECRET === config.ENCRYPTION_KEY) {
    errors.push('ENCRYPTION_KEY deve ser diferente de JWT_SECRET');
  }
  // Fora da Lambda (ECS, VPS...), quantos proxies há na frente define o IP real do cliente,
  // base do rate limit. Errar para menos bloqueia todo mundo junto; para mais, permite forjar o IP.
  if (!config.AWS_LAMBDA_FUNCTION_NAME && config.TRUST_PROXY === undefined) {
    errors.push(
      'TRUST_PROXY é obrigatória fora da Lambda: 1 atrás de um load balancer (ALB), 0 se a API recebe as conexões direto',
    );
  }
  if (typeof config.ENCRYPTION_KEY === 'string' && config.ENCRYPTION_KEY.length < 32) {
    errors.push('ENCRYPTION_KEY deve ter pelo menos 32 caracteres em produção');
  }
  if (typeof config.JWT_SECRET === 'string' && config.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET deve ter pelo menos 32 caracteres em produção');
  }
  if (config.DB_TYPE === 'sqljs') {
    errors.push('DB_TYPE=sqljs (banco em memória) não pode ser usado em produção');
  }
  if (config.DB_SYNCHRONIZE === 'true') {
    errors.push('DB_SYNCHRONIZE=true não pode ser usado em produção — use migrations');
  }
  if (config.STORAGE_DRIVER !== 's3') {
    errors.push(
      'STORAGE_DRIVER deve ser s3 em produção (o driver local grava no disco da instância)',
    );
  } else if (!config.STORAGE_S3_BUCKET) {
    errors.push('STORAGE_S3_BUCKET é obrigatória com STORAGE_DRIVER=s3');
  }
  if (config.MAIL_TRANSPORT === 'json') {
    errors.push('MAIL_TRANSPORT=json não envia e-mails — use smtp ou ses em produção');
  }
  return errors;
}

/** Configurações aceitas, mas que enfraquecem a segurança em produção: avisam no log. */
function productionWarnings(config: Record<string, unknown>): string[] {
  if (config.NODE_ENV !== 'production') return [];
  const warnings: string[] = [];
  if (config.RATE_LIMIT_ENABLED === 'false') warnings.push('RATE_LIMIT_ENABLED=false');
  if (config.REQUIRE_EMAIL_VERIFICATION === 'false') {
    warnings.push('REQUIRE_EMAIL_VERIFICATION=false');
  }
  if (config.DB_SSL !== 'true') warnings.push('DB_SSL desligado (conexão com o banco sem TLS)');
  else if (config.DB_SSL_REJECT_UNAUTHORIZED === 'false') {
    warnings.push('DB_SSL_REJECT_UNAUTHORIZED=false (certificado do banco não é conferido)');
  }
  if (config.SWAGGER_ENABLED === 'true')
    warnings.push('SWAGGER_ENABLED=true (documentação pública)');
  return warnings;
}

export function validateEnv(config: Record<string, unknown>) {
  for (const warning of productionWarnings(config)) {
    console.warn(`[config] Atenção em produção: ${warning}`);
  }
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const messages = [
    ...validateSync(validated, { skipMissingProperties: false }).flatMap((e) =>
      Object.values(e.constraints ?? {}),
    ),
    ...productionErrors(config),
  ];

  if (messages.length > 0) {
    throw new Error(`Variáveis de ambiente inválidas:\n- ${messages.join('\n- ')}`);
  }
  return config;
}
