import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { verifyPassword } from '../../common/crypto/password-hash';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { i18nKey } from '../../i18n/translations';
import { MailService } from '../../mail/mail.service';
import { User } from '../../users/entities/user.entity';
import { passwordLinkSecret } from '../../users/password-link';
import { UsersService } from '../../users/users.service';
import { AuthTokensDto } from '../dto/auth-response.dto';
import { ResetPasswordPayload } from '../interfaces/jwt-payload.interface';
import { SessionService } from '../../sessions/session.service';

/** Esqueci a senha, redefinição por token e troca de senha. */
@Injectable()
export class PasswordService {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Gera um token de redefinição assinado com um segredo derivado do JWT_SECRET e do hash atual da senha.
   * Assim o token deixa de valer automaticamente assim que a senha é trocada
   * (uso único) — sem precisar de tabela/colunas extras.
   */
  async forgot(email: string): Promise<void> {
    const user = await this.usersService.findByEmailWithPassword(email);
    // Não revelamos se o e-mail existe ou não
    if (!user || !user.isActive) return;

    const expiresIn = this.config.get<number>('jwt.resetPasswordExpiresIn', 900);
    const payload: ResetPasswordPayload = { sub: user.id, purpose: 'reset-password' };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.resetSecret(user),
      expiresIn,
    });

    const resetUrl = `${this.config.get<string>('app.frontendUrl')}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mailService.sendForgotPassword(user, resetUrl, Math.round(expiresIn / 60));
  }

  /** Redefine a senha e encerra todas as sessões abertas (refresh tokens). */
  async reset(token: string, newPassword: string): Promise<void> {
    const invalid = new BadRequestException(i18nKey('password.invalidResetToken'));

    const decoded = this.jwtService.decode<ResetPasswordPayload | null>(token);
    if (!decoded?.sub || decoded.purpose !== 'reset-password') throw invalid;

    const user = await this.usersService.findByIdWithPassword(decoded.sub);
    if (!user || !user.isActive) throw invalid;

    try {
      await this.jwtService.verifyAsync(token, { secret: this.resetSecret(user) });
    } catch {
      throw invalid;
    }

    const firstPassword = !user.password; // convite do admin ou conta só de login social
    await this.usersService.updatePassword(user.id, newPassword);
    await this.sessionService.revokeAllForUser(user.id);
    if (!firstPassword) await this.mailService.sendPasswordChanged(user);
    await this.audit.record(AuditAction.AUTH_PASSWORD_RESET, {
      actorId: user.id,
      ...(firstPassword ? { metadata: { firstPassword: true } } : {}),
    });
  }

  /**
   * Troca a senha do usuário logado. Encerra as outras sessões e devolve
   * um par de tokens novo para a sessão atual continuar logada.
   */
  async change(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthTokensDto> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (user && !user.password) {
      // Conta criada por login social: definir a primeira senha exige provar o e-mail
      throw new BadRequestException(i18nKey('password.notSet'));
    }
    if (!user || !(await verifyPassword(currentPassword, user.password))) {
      throw new BadRequestException(i18nKey('password.wrongCurrentPassword'));
    }

    await this.usersService.updatePassword(user.id, newPassword);
    await this.sessionService.revokeAllForUser(user.id);
    await this.mailService.sendPasswordChanged(user);
    await this.audit.record(AuditAction.AUTH_PASSWORD_CHANGED, { actorId: user.id });
    return this.sessionService.create(user);
  }

  private resetSecret(user: User): string {
    return passwordLinkSecret(this.config.getOrThrow<string>('jwt.secret'), user);
  }
}
