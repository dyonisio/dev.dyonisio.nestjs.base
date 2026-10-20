import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RateLimitStorageModule } from '../../rate-limit/rate-limit.module';
import { SessionsModule } from '../../sessions/sessions.module';
import { Passkey } from './entities/passkey.entity';
import { PasskeyVerifier } from './passkey-verifier.service';

/**
 * Conferência de passkeys, sem rotas. Módulo próprio (como o TwoFactorModule) porque também é
 * usada pelo UsersModule no "confirme que é você" — sem ciclo com o AuthModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Passkey]),
    SessionsModule, // JwtService (desafios)
    RateLimitStorageModule, // desafios de uso único
  ],
  providers: [PasskeyVerifier],
  exports: [PasskeyVerifier],
})
export class PasskeyCoreModule {}
