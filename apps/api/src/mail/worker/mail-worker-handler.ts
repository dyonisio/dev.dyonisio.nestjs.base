/**
 * Entrypoint da Lambda `mailWorker` (gatilho: fila SQS de e-mails).
 * A aplicação (só o necessário para enviar e-mails) é criada uma vez por container.
 */
import { INestApplicationContext, Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Handler, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { Logger } from 'nestjs-pino';
import { MailService } from '../mail.service';
import { processMailRecords } from './mail-worker';
import { MailWorkerModule } from './mail-worker.module';

let app: Promise<INestApplicationContext> | undefined;

async function bootstrap(): Promise<INestApplicationContext> {
  const context = await NestFactory.createApplicationContext(MailWorkerModule, {
    bufferLogs: true,
  });
  context.useLogger(context.get(Logger));
  return context;
}

export const handler: Handler<SQSEvent, SQSBatchResponse> = async (event) => {
  app ??= bootstrap().catch((err) => {
    app = undefined; // permite nova tentativa na próxima invocação
    throw err;
  });
  const context = await app;
  return processMailRecords(event.Records, context.get(MailService), new NestLogger('MailWorker'));
};
