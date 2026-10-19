import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { i18nKey } from '../../i18n/translations';
import { SessionService } from '../../sessions/session.service';
import { User } from '../../users/entities/user.entity';
import { verifyPassword } from '../../common/crypto/password-hash';
import { RequestContext } from '../../common/request-context/request-context';
import { describeUserAgent } from '../../common/utils/user-agent';
import { MailService } from '../../mail/mail.service';
import { UsersService } from '../../users/users.service';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { LoginDto } from '../dto/login.dto';
import { TwoFactorChallengeDto } from '../two-factor/dto/two-factor.dto';
import { LoginMethod, TwoFactorService } from '../two-factor/two-factor.service';

/** Tokens da sessão — ou, se o usuário tem 2FA, o desafio do segundo passo. */
export type LoginResult = AuthResponseDto | TwoFactorChallengeDto;

/** Sessão: login (senha, social, 2FA), refresh e logout. */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async login({ email, password }: LoginDto): Promise<LoginResult> {
    const user = await this.usersService.findByEmailWithPassword(email);
    // Sempre executa o bcrypt, exista o usuário ou não (tempo de resposta constante).
    // Contas criadas só por login social não têm senha: a verificação falha.
    const valid = await verifyPassword(password, user?.password);

    if (!user || !valid || !user.isActive) {
      await this.audit.record(AuditAction.AUTH_LOGIN_FAILED, {
        actorId: user?.id ?? null,
        metadata: {
          email,
          reason: !user ? 'unknown_email' : !valid ? 'wrong_password' : 'inactive_user',
        },
      });
      throw new UnauthorizedException(
        i18nKey(user && valid ? 'auth.userInactive' : 'auth.invalidCredentials'),
      );
    }

    delete user.password;
    return this.completeLogin(user, 'password');
  }

  /**
   * Último passo de qualquer login (senha ou social): com 2FA ativo devolve o desafio;
   * sem 2FA, abre a sessão.
   */
  async completeLogin(user: User, method: LoginMethod): Promise<LoginResult> {
    if (user.twoFactorEnabledAt) return this.twoFactor.createChallenge(user, method);
    return this.openSession(user, method);
  }

  /** Segundo passo do login com 2FA: código do app (ou de recuperação) -> tokens. */
  async verifyTwoFactor(twoFactorToken: string, code: string): Promise<AuthResponseDto> {
    const { user, method, usedRecoveryCode } = await this.twoFactor.completeChallenge(
      twoFactorToken,
      code,
    );
    return this.openSession(user, method, { twoFactor: usedRecoveryCode ? 'recovery' : 'totp' });
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const { user, tokens } = await this.sessionService.refresh(refreshToken);
    return { ...tokens, user };
  }

  /** Revoga a sessão: o refresh token e os access tokens dela param de valer na hora. */
  async logout(refreshToken: string): Promise<void> {
    const userId = await this.sessionService.revoke(refreshToken);
    if (userId) await this.audit.record(AuditAction.AUTH_LOGOUT, { actorId: userId });
  }

  private async openSession(
    user: User,
    method: LoginMethod,
    extra: Record<string, unknown> = {},
  ): Promise<AuthResponseDto> {
    const ctx = RequestContext.get();
    // Conta sem idioma salvo: adota o idioma em que a pessoa está usando o site (antes do
    // e-mail de "novo acesso", para ele já sair no idioma certo)
    if (!user.locale && ctx?.requestedLang) {
      if (await this.usersService.adoptLocale(user.id, ctx.requestedLang)) {
        user.locale = ctx.requestedLang;
      }
    }
    const newDevice = await this.sessionService.isNewDevice(user.id, ctx?.userAgent);
    const tokens = await this.sessionService.create(user);
    await this.audit.record(AuditAction.AUTH_LOGIN, {
      actorId: user.id,
      metadata: { method, ...extra, ...(newDevice ? { newDevice: true } : {}) },
    });
    if (newDevice) {
      await this.mail.sendNewLogin(user, {
        description: describeUserAgent(ctx?.userAgent),
        ip: ctx?.ip ?? null,
      });
    }
    return { ...tokens, user };
  }
}
