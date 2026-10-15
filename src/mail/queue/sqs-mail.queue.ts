import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { MailJob, MailQueue } from '../mail.types';

/**
 * Fila de e-mails no Amazon SQS. A API só publica a mensagem (rápido e com tempo
 * constante); a Lambda `mailWorker` consome, renderiza e envia — com novas tentativas
 * automáticas e uma fila de mensagens mortas (DLQ) para o que falhar repetidamente.
 */
export class SqsMailQueue implements MailQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async enqueue(job: MailJob): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(job),
        // Facilita filtrar/inspecionar mensagens no console sem abrir o corpo
        MessageAttributes: { template: { DataType: 'String', StringValue: job.template } },
      }),
    );
  }
}
