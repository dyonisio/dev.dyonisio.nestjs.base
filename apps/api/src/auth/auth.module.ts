import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { SessionsModule } from '../sessions/sessions.module';
import { User } from '../users/entities/user.entity';
import { UserIdentity } from './social/entities/user-identity.entity';
import { JwksResolver, OidcVerifier } from './social/oidc-verifier.service';
import { SocialAuthController } from './social/social-auth.controller';
import { SocialAuthService } from './social/social-auth.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { EmailVerificationController } from './controllers/email-verification.controller';
import { MagicLinkController } from './controllers/magic-link.controller';
import { PasswordController } from './controllers/password.controller';
import { RegistrationController } from './controllers/registration.controller';
import { AuthService } from './services/auth.service';
import { MagicLinkService } from './services/magic-link.service';
import { SessionCookie, SessionCookieInterceptor } from './session-cookie';
import { PasswordService } from './services/password.service';
import { RegistrationService } from './services/registration.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AdminTwoFactorController, TwoFactorController } from './two-factor/two-factor.controller';
import { TwoFactorModule } from './two-factor/two-factor.module';

@Module({
  // SessionsModule também exporta o JwtModule (usado pelo PasswordService nos tokens de reset)
  imports: [
    TypeOrmModule.forFeature([User, UserIdentity]),
    UsersModule,
    SessionsModule,
    MailModule,
    PassportModule,
    TwoFactorModule,
  ],
  controllers: [
    AuthController,
    RegistrationController,
    PasswordController,
    MagicLinkController,
    EmailVerificationController,
    TwoFactorController,
    AdminTwoFactorController,
    SocialAuthController,
  ],
  providers: [
    AuthService,
    RegistrationService,
    PasswordService,
    MagicLinkService,
    SessionCookie,
    { provide: APP_INTERCEPTOR, useClass: SessionCookieInterceptor },
    SocialAuthService,
    OidcVerifier,
    JwksResolver,
    JwtStrategy,
  ],
})
export class AuthModule {}
