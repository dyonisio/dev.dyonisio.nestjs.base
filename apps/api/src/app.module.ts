import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { I18nExceptionFilter } from './common/filters/i18n-exception.filter';
import { buildLoggerOptions } from './common/logging/logger.config';
import { EmailVerifiedGuard } from './common/guards/email-verified.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { buildTypeOrmOptions } from './database/typeorm.config';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { I18nModule } from './i18n/i18n.module';
import { MailModule } from './mail/mail.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { AppThrottlerGuard } from './rate-limit/app-throttler.guard';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildLoggerOptions,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    I18nModule,
    AuditModule,
    RateLimitModule,
    MailModule,
    UsersModule,
    AuthModule,
    FilesModule,
    HealthModule,
    MaintenanceModule,
  ],
  providers: [
    // Ordem importa: 1) rate limit (barra abuso antes de qualquer consulta ao banco de usuários)
    //               2) autentica (JWT)  3) exige e-mail confirmado  4) roles  5) permissões
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Padroniza e traduz todas as respostas de erro (Accept-Language)
    { provide: APP_FILTER, useClass: I18nExceptionFilter },
  ],
})
export class AppModule {}
