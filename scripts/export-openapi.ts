/**
 * Gera o contrato da API em ./openapi.json — o mesmo documento do Swagger (/docs),
 * sem precisar de banco nem servidor rodando.
 *
 * Uso: npm run openapi:export
 *
 * O arquivo fica commitado: toda mudança de rota/DTO aparece no diff do PR, o CI confere
 * que ele está atualizado, e o front gera tipos/cliente a partir dele (docs/API_CLIENT.md).
 */
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Ambiente mínimo e descartável: banco em memória, sem e-mails, sem logs
Object.assign(process.env, {
  NODE_ENV: 'development',
  DB_TYPE: 'sqljs',
  JWT_SECRET: 'somente-para-gerar-o-openapi-0000000000',
  MAIL_TRANSPORT: 'json',
  MAIL_DELIVERY: 'sync',
  STORAGE_DRIVER: 'local',
  SWAGGER_ENABLED: 'false',
  LOG_LEVEL: 'silent',
  APP_NAME: 'NestJS Base API',
});

async function run() {
  // Importados depois do ambiente pronto (a configuração é lida na importação)
  const { AppModule } = await import('../src/app.module');
  const { buildOpenApiDocument, configureApp } = await import('../src/app.setup');

  const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
  const document = buildOpenApiDocument(app);
  await app.close();

  const target = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`[openapi] ${Object.keys(document.paths).length} rotas -> ${target}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
