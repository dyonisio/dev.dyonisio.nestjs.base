import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import configuration from '../config/configuration';

type MailConfig = ReturnType<typeof configuration>['mail'];

/**
 * Cria o transporter do Nodemailer conforme MAIL_TRANSPORT:
 *  - smtp: qualquer servidor SMTP (Mailpit local, SendGrid, Gmail, SES SMTP...)
 *  - ses:  Amazon SES via SDK (ideal na Lambda — usa a IAM role, sem credenciais SMTP)
 *  - json: não envia; apenas serializa a mensagem (dev/testes)
 */
export function createMailTransport(config: ConfigService): nodemailer.Transporter {
  const mail = config.getOrThrow<MailConfig>('mail');

  switch (mail.transport) {
    case 'ses': {
      const sesClient = new SESv2Client({ region: mail.ses.region });
      return nodemailer.createTransport({ SES: { sesClient, SendEmailCommand } } as any);
    }
    case 'json':
      return nodemailer.createTransport({ jsonTransport: true });
    case 'smtp':
    default:
      return nodemailer.createTransport({
        host: mail.smtp.host,
        port: mail.smtp.port,
        secure: mail.smtp.secure,
        auth: mail.smtp.user ? { user: mail.smtp.user, pass: mail.smtp.pass } : undefined,
      });
  }
}
