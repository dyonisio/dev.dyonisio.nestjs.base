import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Passkey } from '../auth/passkeys/entities/passkey.entity';
import { PasskeyCoreModule } from '../auth/passkeys/passkey-core.module';
import { UserIdentity } from '../auth/social/entities/user-identity.entity';
import { TwoFactorModule } from '../auth/two-factor/two-factor.module';
import { FilesModule } from '../files/files.module';
import { MailModule } from '../mail/mail.module';
import { RateLimitStorageModule } from '../rate-limit/rate-limit.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AccountPurgeService } from './account/account-purge.service';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { ReauthService } from './account/reauth.service';
import { EmailVerificationService } from './email-verification.service';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UserInvitationService } from './user-invitation.service';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserIdentity, Passkey]),
    PasskeyCoreModule, // "confirme que é você" com passkey
    MailModule,
    // encerrar sessões ao excluir/desativar + JwtService (links de confirmação)
    SessionsModule,
    FilesModule,
    // confirmar ações sensíveis com o código 2FA + limite de tentativas de senha
    TwoFactorModule,
    RateLimitStorageModule,
  ],
  // AccountController primeiro: DELETE /users/me precisa vir antes de DELETE /users/:id
  controllers: [AccountController, UsersController],
  providers: [
    UsersService,
    UserInvitationService,
    EmailVerificationService,
    AccountService,
    ReauthService,
    AccountPurgeService,
  ],
  exports: [UsersService, EmailVerificationService, ReauthService, AccountPurgeService],
})
export class UsersModule {}
