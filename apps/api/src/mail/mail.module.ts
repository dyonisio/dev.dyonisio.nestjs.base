import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_QUEUE, MAIL_TRANSPORTER } from './mail.constants';
import { MailTemplateService } from './mail-template.service';
import { createMailTransport } from './mail-transport.factory';
import { MailService } from './mail.service';
import { createMailQueue } from './queue/mail-queue.factory';

@Module({
  providers: [
    MailTemplateService,
    MailService,
    {
      provide: MAIL_TRANSPORTER,
      inject: [ConfigService],
      useFactory: createMailTransport,
    },
    {
      // null quando MAIL_DELIVERY=sync (envio direto, sem fila)
      provide: MAIL_QUEUE,
      inject: [ConfigService],
      useFactory: createMailQueue,
    },
  ],
  exports: [MailService, MailTemplateService],
})
export class MailModule {}
