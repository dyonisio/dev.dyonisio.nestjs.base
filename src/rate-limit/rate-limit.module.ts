import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseThrottlerStorage } from './database-throttler.storage';
import { RateLimit } from './rate-limit.entity';
import { buildThrottlerOptions, RateLimitConfig } from './rate-limit.options';

/**
 * Contadores no banco. Exportado para outros limites além do throttler HTTP
 * (ex.: tentativas de código 2FA por usuário).
 */
@Module({
  imports: [TypeOrmModule.forFeature([RateLimit])],
  providers: [DatabaseThrottlerStorage],
  exports: [DatabaseThrottlerStorage],
})
export class RateLimitStorageModule {}

/** Rate limiting com contadores no banco. A lógica dos limites está em rate-limit.options.ts. */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RateLimitStorageModule],
      inject: [ConfigService, DatabaseThrottlerStorage],
      useFactory: (config: ConfigService, storage: DatabaseThrottlerStorage) =>
        buildThrottlerOptions(config.getOrThrow<RateLimitConfig>('rateLimit'), storage),
    }),
  ],
})
export class RateLimitModule {}
