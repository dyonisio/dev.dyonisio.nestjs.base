import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { deriveSecret } from '../../common/crypto/derive-secret';
import { MailService } from '../../mail/mail.service';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { i18nKey } from '../../i18n/translations';
import { DatabaseThrottlerStorage } from '../../rate-limit/database-throttler.storage';
import { User } from '../../users/entities/user.entity';
import { base32Encode, generateTotpSecret, otpauthUrl, verifyTotp } from './totp';

export type LoginMethod = 'password' | 'magic-link' | 'google' | 'apple';

interface ChallengePayload {
  sub: string;
  purpose: '2fa-login';
  method: LoginMethod;
}

const RECOVERY_CODES = 10;
const CHALLENGE_TTL = 300; // 5 min para digitar o código
/** Tentativas de código por usuário (TOTP ou recuperação) por janela — contra força bruta distribuída. */
const MAX_ATTEMPTS = 10;
const ATTEMPTS_WINDOW_MS = 15 * 60 * 1000;

const hashRecoveryCode = (code: string) =>
  createHash('sha256')
    .update(code.toUpperCase().replace(/[^A-Z2-7]/g, ''))
    .digest('hex');

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly attempts: DatabaseThrottlerStorage,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Passo 1: gera um segredo (ainda inativo) e o link para o app autenticador. */
  async setup(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.load(userId);
    if (user.twoFactorEnabledAt) throw new BadRequestException(i18nKey('twoFactor.alreadyEnabled'));

    const secret = generateTotpSecret();
    await this.users.update(userId, {
      twoFactorSecret: this.encryption.encrypt(secret),
      twoFactorLastStep: null,
    });
    return {
      secret,
      otpauthUrl: otpauthUrl({
        secret,
        account: user.email,
        issuer: this.config.get<string>('app.name', 'NestJS Base'),
        image: this.config.get<string>('app.totpImageUrl'),
      }),
    };
  }

  /** Passo 2: confirma com um código do app (prova que ficou configurado) e ativa. */
  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.load(userId);
    if (user.twoFactorEnabledAt) throw new BadRequestException(i18nKey('twoFactor.alreadyEnabled'));
    if (!user.twoFactorSecret) throw new BadRequestException(i18nKey('twoFactor.notSetUp'));

    await this.limitAttempts(userId);
    const step = verifyTotp(this.encryption.decrypt(user.twoFactorSecret), code);
    if (step === null) throw new BadRequestException(i18nKey('twoFactor.invalidCode'));

    const recoveryCodes = this.newRecoveryCodes();
    await this.users.update(userId, {
      twoFactorEnabledAt: new Date(),
      twoFactorLastStep: step,
      twoFactorRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
    });
    await this.audit.record(AuditAction.AUTH_2FA_ENABLED, { actorId: userId });
    await this.mail.sendTwoFactorChanged(user, true);
    return { recoveryCodes };
  }

  /** Desativa — exige um código válido (do app ou de recuperação). */
  async disable(userId: string, code: string): Promise<void> {
    await this.verifyCode(userId, code);
    await this.clear(userId);
    await this.audit.record(AuditAction.AUTH_2FA_DISABLED, { actorId: userId });
    await this.mail.sendTwoFactorChanged(await this.load(userId), false);
  }

  /** Gera 10 códigos novos (os antigos deixam de valer) — exige um código do app. */
  async regenerateRecoveryCodes(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const method = await this.verifyCode(userId, code);
    if (method !== 'totp') throw new BadRequestException(i18nKey('twoFactor.invalidCode'));

    const recoveryCodes = this.newRecoveryCodes();
    await this.users.update(userId, {
      twoFactorRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
    });
    await this.audit.record(AuditAction.AUTH_2FA_RECOVERY_CODES_REGENERATED, { actorId: userId });
    return { recoveryCodes };
  }

  /** Admin desativa o 2FA de alguém que perdeu o celular e os códigos de recuperação. */
  async adminReset(targetUserId: string): Promise<void> {
    const user = await this.users.findOne({ where: { id: targetUserId } });
    if (!user) throw new HttpException(i18nKey('users.notFound'), HttpStatus.NOT_FOUND);
    await this.clear(targetUserId);
    await this.audit.record(AuditAction.AUTH_2FA_RESET_BY_ADMIN, {
      target: { type: 'user', id: targetUserId },
    });
    if (user.twoFactorEnabledAt)
      await this.mail.sendTwoFactorChanged(user, false, { byAdmin: true });
  }

  // ---------- Login em duas etapas ----------

  /** Em vez dos tokens, o login devolve este desafio quando o usuário tem 2FA. */
  async createChallenge(user: User, method: LoginMethod) {
    const payload: ChallengePayload = { sub: user.id, purpose: '2fa-login', method };
    return {
      twoFactorRequired: true as const,
      twoFactorToken: await this.jwt.signAsync(payload, {
        secret: this.challengeSecret,
        expiresIn: CHALLENGE_TTL,
      }),
      expiresIn: CHALLENGE_TTL,
    };
  }

  /** Confere o desafio + código e devolve o usuário para a sessão ser aberta. */
  async completeChallenge(
    twoFactorToken: string,
    code: string,
  ): Promise<{ user: User; method: LoginMethod; usedRecoveryCode: boolean }> {
    let payload: ChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<ChallengePayload>(twoFactorToken, {
        secret: this.challengeSecret,
      });
    } catch {
      throw new UnauthorizedException(i18nKey('twoFactor.invalidChallenge'));
    }
    if (payload.purpose !== '2fa-login') {
      throw new UnauthorizedException(i18nKey('twoFactor.invalidChallenge'));
    }

    const usedMethod = await this.verifyCode(payload.sub, code);
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user?.isActive) throw new UnauthorizedException(i18nKey('auth.userInactive'));

    return { user, method: payload.method, usedRecoveryCode: usedMethod === 'recovery' };
  }

  /**
   * Confere um código do app (TOTP) ou um código de recuperação (que é consumido).
   * Limita tentativas por usuário e impede reutilizar o mesmo código TOTP.
   * Também usado para confirmar ações sensíveis (ReauthService).
   */
  async verifyCode(userId: string, code: string): Promise<'totp' | 'recovery'> {
    const user = await this.load(userId);
    if (!user.twoFactorEnabledAt || !user.twoFactorSecret) {
      throw new BadRequestException(i18nKey('twoFactor.notEnabled'));
    }
    await this.limitAttempts(userId);

    const step = verifyTotp(this.encryption.decrypt(user.twoFactorSecret), code);
    if (step !== null) {
      // Update condicional (atômico): o código de uma janela já usada — ou duas requisições
      // simultâneas com o mesmo código — só passa uma vez
      const { affected } = await this.users
        .createQueryBuilder()
        .update(User)
        .set({ twoFactorLastStep: step })
        .where('id = :userId', { userId })
        .andWhere('("twoFactorLastStep" IS NULL OR "twoFactorLastStep" < :step)', { step })
        .execute();
      if (!affected) throw new BadRequestException(i18nKey('twoFactor.invalidCode')); // já usado
      return 'totp';
    }

    const hash = hashRecoveryCode(code);
    const remaining = user.twoFactorRecoveryCodes ?? [];
    if (code.length >= 8 && remaining.includes(hash)) {
      // Só consome se a lista ainda for a que lemos: o mesmo código não vale duas vezes
      const { affected } = await this.users
        .createQueryBuilder()
        .update(User)
        .set({ twoFactorRecoveryCodes: remaining.filter((h) => h !== hash) })
        .where('id = :userId', { userId })
        .andWhere('"twoFactorRecoveryCodes" = :current', { current: JSON.stringify(remaining) })
        .execute();
      if (!affected) throw new BadRequestException(i18nKey('twoFactor.invalidCode'));
      await this.audit.record(AuditAction.AUTH_2FA_RECOVERY_CODE_USED, {
        actorId: userId,
        metadata: { remaining: remaining.length - 1 },
      });
      return 'recovery';
    }

    await this.audit.record(AuditAction.AUTH_2FA_FAILED, { actorId: userId });
    throw new BadRequestException(i18nKey('twoFactor.invalidCode'));
  }

  private async limitAttempts(userId: string): Promise<void> {
    const { isBlocked, timeToExpire } = await this.attempts.increment(
      `2fa:${userId}`,
      ATTEMPTS_WINDOW_MS,
      MAX_ATTEMPTS,
    );
    if (isBlocked) {
      throw new HttpException(
        { key: 'errors.tooManyRequests', args: { seconds: timeToExpire } },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async clear(userId: string): Promise<void> {
    await this.users.update(userId, {
      twoFactorEnabledAt: null,
      twoFactorSecret: null,
      twoFactorLastStep: null,
      twoFactorRecoveryCodes: null,
    });
  }

  private load(userId: string): Promise<User> {
    return this.users
      .createQueryBuilder('user')
      .addSelect(['user.twoFactorSecret', 'user.twoFactorLastStep', 'user.twoFactorRecoveryCodes'])
      .where('user.id = :userId', { userId })
      .getOneOrFail();
  }

  /** "ABCD-EFGH": 40 bits aleatórios cada, fáceis de anotar. */
  private newRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODES }, () => {
      const code = base32Encode(randomBytes(5));
      return `${code.slice(0, 4)}-${code.slice(4)}`;
    });
  }

  private get challengeSecret(): string {
    return deriveSecret(this.config.getOrThrow<string>('jwt.secret'), '2fa-login');
  }
}
