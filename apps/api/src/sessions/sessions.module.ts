import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT_ALGORITHM } from '../common/crypto/derive-secret';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { Session } from './entities/session.entity';
import { SessionService } from './session.service';
import { User } from '../users/entities/user.entity';
import { AdminSessionsController } from './admin-sessions.controller';
import { SessionsController } from './sessions.controller';

/**
 * Sessões e tokens (access JWT + refresh). Módulo próprio para que tanto o auth
 * (login, refresh, logout) quanto users (remover/desativar usuário encerra as sessões)
 * possam usá-lo sem dependência circular.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Session, RefreshToken, User]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        // Algoritmo fixo na emissão E na verificação: um token com outro `alg` é recusado
        signOptions: {
          expiresIn: config.get<number>('jwt.expiresIn', 900),
          algorithm: JWT_ALGORITHM,
        },
        verifyOptions: { algorithms: [JWT_ALGORITHM] },
      }),
    }),
  ],
  // A ordem importa: /users/me/sessions antes de /users/:id/sessions (o "me" não vira um :id)
  controllers: [SessionsController, AdminSessionsController],
  providers: [SessionService],
  exports: [SessionService, JwtModule],
})
export class SessionsModule {}
