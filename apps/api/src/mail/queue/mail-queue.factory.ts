import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import configuration from '../../config/configuration';
import { MailQueue } from '../mail.types';
import { SqsMailQueue } from './sqs-mail.queue';

type MailConfig = ReturnType<typeof configuration>['mail'];

/**
 * MAIL_DELIVERY=sync (padrão): sem fila — o e-mail é enviado durante a requisição.
 * MAIL_DELIVERY=sqs: e-mails vão para a fila MAIL_QUEUE_URL e o worker envia.
 */
export function createMailQueue(config: ConfigService): MailQueue | null {
  const mail = config.getOrThrow<MailConfig>('mail');
  if (mail.delivery !== 'sqs') return null;

  if (!mail.queueUrl) {
    throw new Error('MAIL_DELIVERY=sqs exige MAIL_QUEUE_URL');
  }
  return new SqsMailQueue(new SQSClient({ region: mail.ses.region }), mail.queueUrl);
}
