import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT_ALGORITHM } from '../../common/crypto/derive-secret';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RequestContext } from '../../common/request-context/request-context';
import { i18nKey } from '../../i18n/translations';
import { User } from '../../users/entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { SessionService } from '../../sessions/session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly sessionService: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.secret'),
      algorithms: [JWT_ALGORITHM],
    });
  }

  /**
   * A assinatura e o `exp` já foram validados (sem banco) pelo passport-jwt.
   * Aqui fazemos UMA query (sessão + usuário) para que logout, troca de senha,
   * mudança de role, desativação e remoção valham imediatamente.
   */
  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.sessionService.findActiveUser(payload.sid);
    if (!user || user.id !== payload.sub) {
      throw new UnauthorizedException(i18nKey('auth.sessionExpired'));
    }
    // Disponível para logs, auditoria e "meus dispositivos" (sessão atual)
    RequestContext.set({ userId: user.id, sessionId: payload.sid });
    return user;
  }
}
