import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from '../audit/audit.module';
import { buildLoggerOptions } from '../common/logging/logger.config';
import configuration from '../config/configuration';
import { validateEnv } from '../config/env.validation';
import { buildTypeOrmOptions } from '../database/typeorm.config';
import { I18nModule } from '../i18n/i18n.module';
import { MaintenanceModule } from './maintenance.module';

/**
 * Aplicação mínima do job de manutenção: configuração, logs, banco, i18n (e-mails) e
 * as tarefas. Sem HTTP — usada pela Lambda agendada e pelo comando `npm run maintenance`.
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
    TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: buildTypeOrmOptions }),
    I18nModule,
    AuditModule,
    MaintenanceModule,
  ],
})
export class MaintenanceAppModule {}
