import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwoFactorService } from '../../auth/two-factor/two-factor.service';
import { verifyPassword } from '../../common/crypto/password-hash';
import { RequestContext } from '../../common/request-context/request-context';
import { i18nKey } from '../../i18n/translations';
import { DatabaseThrottlerStorage } from '../../rate-limit/database-throttler.storage';
import { SessionService } from '../../sessions/session.service';
import { UsersService } from '../users.service';
import { ReauthDto } from './dto/account.dto';

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * "Confirme que é você" antes de ações sensíveis (excluir a conta, trocar o e-mail, ativar 2FA).
 * Um access token roubado (XSS, celular desbloqueado...) não basta para elas:
 *  - quem tem senha precisa informá-la;
 *  - quem não tem (só login social) precisa ter entrado há pouco (REAUTH_WINDOW_SECONDS);
 *  - quem tem 2FA precisa também do código.
 */
@Injectable()
export class ReauthService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly attempts: DatabaseThrottlerStorage,
    private readonly config: ConfigService,
  ) {}

  async confirm(userId: string, proof: ReauthDto, options: { skipTwoFactor?: boolean } = {}) {
    const user = await this.users.findByIdWithPassword(userId);
    if (!user) throw new UnauthorizedException(i18nKey('auth.sessionExpired'));

    if (user.password) {
      if (!proof.currentPassword) {
        throw new BadRequestException(i18nKey('account.passwordRequired'));
      }
      await this.limitAttempts(userId); // senha errada com token roubado: sem força bruta
      if (!(await verifyPassword(proof.currentPassword, user.password))) {
        throw new BadRequestException(i18nKey('password.wrongCurrentPassword'));
      }
    } else {
      const session = await this.sessions.findById(RequestContext.get()?.sessionId);
      const window = this.config.get<number>('security.reauthWindow', 600) * 1000;
      if (!session || Date.now() - session.createdAt.getTime() > window) {
        throw new UnauthorizedException(i18nKey('account.reauthRequired'));
      }
    }

    if (user.twoFactorEnabledAt && !options.skipTwoFactor) {
      if (!proof.code) throw new BadRequestException(i18nKey('twoFactor.codeRequired'));
      await this.twoFactor.verifyCode(userId, proof.code);
    }
    return user;
  }

  private async limitAttempts(userId: string): Promise<void> {
    const { isBlocked, timeToExpire } = await this.attempts.increment(
      `reauth:${userId}`,
      WINDOW_MS,
      MAX_ATTEMPTS,
    );
    if (isBlocked) {
      throw new HttpException(
        { key: 'errors.tooManyRequests', args: { seconds: timeToExpire } },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
