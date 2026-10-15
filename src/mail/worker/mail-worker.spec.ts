import 'reflect-metadata';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { SQSRecord } from 'aws-lambda';
import { MailService } from '../mail.service';
import { MailJob, MailTemplate } from '../mail.types';
import { processMailRecords } from './mail-worker';

const job: MailJob = {
  to: 'ana@test.com',
  subject: 'Welcome',
  template: MailTemplate.WELCOME,
  context: { name: 'Ana', loginUrl: 'http://front.test/login' },
  lang: 'en',
};
const record = (messageId: string, body: unknown, receiveCount = '1') =>
  ({
    messageId,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: { ApproximateReceiveCount: receiveCount },
  }) as unknown as SQSRecord;

describe('processMailRecords (worker da fila)', () => {
  const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('entrega cada mensagem e não devolve nenhuma para a fila', async () => {
    const mail = { deliver: jest.fn().mockResolvedValue(true) };

    const result = await processMailRecords([record('m1', job), record('m2', job)], mail, logger);

    expect(mail.deliver).toHaveBeenCalledTimes(2);
    expect(mail.deliver).toHaveBeenCalledWith(job, { throwOnError: true });
    expect(result).toEqual({ batchItemFailures: [] });
  });

  it('só as que falharam voltam para a fila (as outras não são reenviadas)', async () => {
    const mail = {
      deliver: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('SES throttling'))
        .mockResolvedValueOnce(true),
    };

    const result = await processMailRecords(
      [record('m1', job), record('m2', job, '3'), record('m3', job)],
      mail,
      logger,
    );

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'm2' }] });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('messageId=m2, tentativa 3'),
      expect.stringContaining('SES throttling'),
    );
  });

  it('mensagem corrompida (JSON inválido) falha e segue para a DLQ após as tentativas', async () => {
    const mail = { deliver: jest.fn() };

    const result = await processMailRecords([record('ruim', '{nao-e-json')], mail, logger);

    expect(mail.deliver).not.toHaveBeenCalled();
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'ruim' }]);
  });
});

describe('MailWorkerModule', () => {
  let app: INestApplicationContext;
  const env = process.env;

  beforeAll(async () => {
    process.env = {
      ...env,
      JWT_SECRET: 'segredo-do-worker-com-tamanho-ok',
      MAIL_TRANSPORT: 'json',
      MAIL_DELIVERY: 'sync',
      LOG_LEVEL: 'silent',
    };
    // Importado só agora: o ConfigModule.forRoot() lê e valida o ambiente quando o módulo é
    // carregado. Com import no topo, o teste dependeria de um .env local (que não existe no CI).
    const { MailWorkerModule } = await import('./mail-worker.module');
    app = await NestFactory.createApplicationContext(MailWorkerModule, {
      logger: false,
      abortOnError: false, // falha vira erro do teste, em vez de encerrar o Jest
    });
  });

  afterAll(async () => {
    await app?.close();
    process.env = env;
  });

  it('sobe sem banco de dados e entrega um job de verdade (transporte json)', async () => {
    await expect(app.get(MailService).deliver(job, { throwOnError: true })).resolves.toBe(true);
  });
});
