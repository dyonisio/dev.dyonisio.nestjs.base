import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { toPersonName } from '../../common/validators/text.validators';
import { i18nKey } from '../../i18n/translations';
import { MailService } from '../../mail/mail.service';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { AuthService, LoginResult } from '../services/auth.service';
import { LoginMethodsDto, SocialLoginDto } from './dto/social.dto';
import { Passkey } from '../passkeys/entities/passkey.entity';
import { UserIdentity } from './entities/user-identity.entity';
import { OidcVerifier, SocialProfile, SocialProvider } from './oidc-verifier.service';

@Injectable()
export class SocialAuthService {
  constructor(
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @InjectRepository(Passkey) private readonly passkeys: Repository<Passkey>,
    private readonly verifier: OidcVerifier,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 1) já vinculado (provider + sub)        -> entra nessa conta
   * 2) e-mail verificado de conta existente -> vincula e entra
   * 3) e-mail novo                          -> cria a conta (já verificada, sem senha)
   * Em todos os casos, quem tem 2FA passa pelo segundo passo.
   */
  async login(provider: SocialProvider, dto: SocialLoginDto): Promise<LoginResult> {
    const profile = await this.verifier.verify(provider, dto.idToken, dto.nonce);
    const user = (await this.findLinkedUser(profile)) ?? (await this.linkOrCreate(profile, dto));

    if (!user.isActive) throw new UnauthorizedException(i18nKey('auth.userInactive'));
    return this.auth.completeLogin(user, provider);
  }

  async loginMethods(userId: string): Promise<LoginMethodsDto> {
    const [user, identities, passkeys] = await Promise.all([
      this.users.findByIdWithPassword(userId),
      this.identities.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.passkeys.count({ where: { userId } }),
    ]);
    return {
      hasPassword: !!user?.password,
      identities: identities.map(({ provider, email, createdAt }) => ({
        provider,
        email,
        createdAt,
      })),
      passkeys,
    };
  }

  /** Desvincula um provedor — sem deixar a conta sem nenhuma forma de login (senha ou passkey). */
  async unlink(userId: string, provider: string): Promise<void> {
    const methods = await this.loginMethods(userId);
    if (!methods.identities.some((i) => i.provider === provider)) {
      throw new NotFoundException(i18nKey('social.identityNotFound'));
    }
    if (!methods.hasPassword && !methods.passkeys && methods.identities.length === 1) {
      throw new BadRequestException(i18nKey('social.lastLoginMethod'));
    }
    await this.identities.delete({ userId, provider });
    await this.audit.record(AuditAction.AUTH_SOCIAL_UNLINKED, {
      actorId: userId,
      metadata: { provider },
    });
  }

  /**
   * O admin desvincula o Google/Apple de alguém (ex.: vinculado por um invasor). Sem a trava de
   * "última forma de login": a pessoa sempre pode entrar pelo link mágico ou criar uma senha
   * pelo "esqueci a senha".
   */
  async unlinkByAdmin(userId: string, provider: string): Promise<void> {
    await this.users.getById(userId);
    const { affected } = await this.identities.delete({ userId, provider });
    if (!affected) throw new NotFoundException(i18nKey('social.identityNotFound'));
    await this.audit.record(AuditAction.AUTH_SOCIAL_UNLINKED, {
      target: { type: 'user', id: userId },
      metadata: { provider, byAdmin: true },
    });
  }

  private async findLinkedUser(profile: SocialProfile): Promise<User | null> {
    const identity = await this.identities.findOne({
      where: { provider: profile.provider, providerUserId: profile.subject },
      relations: { user: true },
    });
    if (!identity) return null;
    if (identity.user) return identity.user;

    // Vínculo de uma conta excluída (soft delete): descarta e segue como login novo
    await this.identities.delete(identity.id);
    return null;
  }

  private async linkOrCreate(profile: SocialProfile, dto: SocialLoginDto): Promise<User> {
    if (!profile.email) throw new BadRequestException(i18nKey('social.emailRequired'));
    // Sem e-mail verificado pelo provedor, vincular a uma conta existente permitiria
    // sequestrá-la (bastaria criar uma conta no provedor com o e-mail da vítima)
    if (!profile.emailVerified) throw new BadRequestException(i18nKey('social.emailNotVerified'));

    const existing = await this.users.findByEmail(profile.email);
    if (existing) {
      // O provedor acabou de provar que a pessoa controla esse e-mail. Se a conta nunca foi
      // confirmada, quem a criou pode ter sido um atacante: senha, 2FA e sessões são descartados.
      const claimed = !existing.emailVerifiedAt;
      if (claimed) await this.users.claimUnverifiedAccount(existing.id);
      await this.link(existing.id, profile);
      await this.audit.record(AuditAction.AUTH_SOCIAL_LINKED, {
        actorId: existing.id,
        metadata: { provider: profile.provider, email: profile.email, claimed },
      });
      if (!claimed) await this.mail.sendSocialLinked(existing, profile.provider);
      return (await this.users.findById(existing.id))!;
    }

    const user = await this.users.createFromProvider({
      name: toPersonName(profile.name ?? dto.name, profile.email.split('@')[0]),
      email: profile.email,
      locale: dto.locale,
    });
    await this.link(user.id, profile);
    await this.audit.record(AuditAction.USER_REGISTERED, {
      actorId: user.id,
      target: { type: 'user', id: user.id },
      metadata: { provider: profile.provider },
    });
    await this.mail.sendWelcome(user);
    return user;
  }

  private async link(userId: string, profile: SocialProfile): Promise<void> {
    await this.identities.save(
      this.identities.create({
        userId,
        provider: profile.provider,
        providerUserId: profile.subject,
        email: profile.email ?? null,
      }),
    );
  }
}
