import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerOptions } from '../../common/logging/logger.config';
import configuration from '../../config/configuration';
import { validateEnv } from '../../config/env.validation';
import { I18nModule } from '../../i18n/i18n.module';
import { MailModule } from '../mail.module';

/**
 * Aplicação mínima do worker de e-mails: só configuração, logs, i18n e e-mail.
 * Sem banco, sem HTTP — sobe rápido (cold start pequeno) e não abre conexões à toa.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({ inject: [ConfigService], useFactory: buildLoggerOptions }),
    I18nModule,
    MailModule,
  ],
})
export class MailWorkerModule {}
