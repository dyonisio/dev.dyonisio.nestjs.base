import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { MailModule } from '../../mail/mail.module';
import { RateLimitStorageModule } from '../../rate-limit/rate-limit.module';
import { SessionsModule } from '../../sessions/sessions.module';
import { User } from '../../users/entities/user.entity';
import { TwoFactorService } from './two-factor.service';

/**
 * Lógica do 2FA, sem rotas (as rotas ficam no AuthModule). Módulo próprio porque também
 * é usada pelo UsersModule para confirmar ações sensíveis (ReauthService) — sem ciclo.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    SessionsModule, // JwtService (token do desafio de login)
    MailModule,
    RateLimitStorageModule, // tentativas por usuário
  ],
  providers: [TwoFactorService, EncryptionService],
  exports: [TwoFactorService, EncryptionService],
})
export class TwoFactorModule {}
