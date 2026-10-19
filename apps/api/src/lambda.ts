/**
 * Entrypoint para AWS Lambda (API Gateway HTTP API).
 * A aplicação Nest é criada uma única vez por container e reaproveitada
 * entre invocações ("warm start"), incluindo as conexões com o banco.
 */
import serverlessExpress from '@codegenie/serverless-express';
import { NestFactory } from '@nestjs/core';
import type { Callback, Context, Handler } from 'aws-lambda';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

let cachedServer: Promise<Handler> | undefined;

async function bootstrap(): Promise<Handler> {
  // abortOnError: false — falha ao subir vira exceção (logada abaixo), em vez de encerrar o processo
  const app = configureApp(
    await NestFactory.create(AppModule, { bufferLogs: true, abortOnError: false }),
  );
  await app.init();
  return serverlessExpress({ app: app.getHttpAdapter().getInstance() });
}

export const handler: Handler = async (event: unknown, context: Context, callback: Callback) => {
  // Não espera o event loop esvaziar (o pool do Postgres mantém sockets abertos)
  context.callbackWaitsForEmptyEventLoop = false;

  cachedServer ??= bootstrap().catch((err: unknown) => {
    cachedServer = undefined; // permite nova tentativa na próxima invocação
    // Os logs do Nest ficam em buffer até a aplicação subir: se ela não sobe (ex.: banco
    // inalcançável), só esta linha chega ao CloudWatch — com o motivo real.
    console.error(
      JSON.stringify({
        level: 'fatal',
        msg: 'Falha ao iniciar a API (veja "error"). Banco inalcançável? Confira o security group/VPC do RDS.',
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      }),
    );
    throw err;
  });
  const server = await cachedServer;
  return server(event, context, callback);
};
