import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { MailJob, MailTemplate } from '../mail.types';
import { createMailQueue } from './mail-queue.factory';
import { SqsMailQueue } from './sqs-mail.queue';

const configWith = (mail: object) =>
  ({
    getOrThrow: () => ({ ses: { region: 'sa-east-1' }, ...mail }),
  }) as unknown as ConfigService;

describe('createMailQueue', () => {
  it('MAIL_DELIVERY=sync (padrão) -> sem fila', () => {
    expect(createMailQueue(configWith({ delivery: 'sync' }))).toBeNull();
  });

  it('MAIL_DELIVERY=sqs sem MAIL_QUEUE_URL -> erro claro na inicialização', () => {
    expect(() => createMailQueue(configWith({ delivery: 'sqs' }))).toThrow(
      'MAIL_DELIVERY=sqs exige MAIL_QUEUE_URL',
    );
  });

  it('MAIL_DELIVERY=sqs com URL -> fila SQS', () => {
    expect(
      createMailQueue(configWith({ delivery: 'sqs', queueUrl: 'https://sqs/q' })),
    ).toBeInstanceOf(SqsMailQueue);
  });
});

describe('SqsMailQueue', () => {
  it('publica o job como JSON na fila configurada', async () => {
    const client = { send: jest.fn().mockResolvedValue({}) } as unknown as SQSClient;
    const job: MailJob = {
      to: 'a@test.com',
      subject: 'Hi',
      template: MailTemplate.WELCOME,
      context: { name: 'A', loginUrl: 'x' },
      lang: 'en',
    };

    await new SqsMailQueue(client, 'https://sqs/q').enqueue(job);

    const command = (client.send as jest.Mock).mock.calls[0][0] as SendMessageCommand;
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input).toEqual({
      QueueUrl: 'https://sqs/q',
      MessageBody: JSON.stringify(job),
      MessageAttributes: { template: { DataType: 'String', StringValue: 'welcome' } },
    });
  });
});
