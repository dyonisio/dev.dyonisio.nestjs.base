import type { LoggerService } from '@nestjs/common';
import type { SQSBatchResponse, SQSRecord } from 'aws-lambda';
import type { MailService } from '../mail.service';
import type { MailJob } from '../mail.types';

/**
 * Processa um lote de mensagens da fila de e-mails.
 *
 * Usa "partial batch response": só as mensagens que falharam voltam para a fila
 * (as que deram certo não são reenviadas). Depois de várias falhas, o SQS move a
 * mensagem para a DLQ (fila de mensagens mortas) para inspeção.
 */
export async function processMailRecords(
  records: SQSRecord[],
  mail: Pick<MailService, 'deliver'>,
  logger: LoggerService,
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of records) {
    try {
      const job = JSON.parse(record.body) as MailJob;
      await mail.deliver(job, { throwOnError: true });
    } catch (error) {
      const attempt = Number(record.attributes?.ApproximateReceiveCount ?? 1);
      logger.error(
        `Falha ao processar e-mail da fila (messageId=${record.messageId}, tentativa ${attempt}) — será tentado de novo: ${(error as Error).message}`,
        (error as Error).stack,
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
