import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { Repository } from 'typeorm';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { deriveSecret } from '../../common/crypto/derive-secret';
import { RequestContext } from '../../common/request-context/request-context';
import { describeUserAgent } from '../../common/utils/user-agent';
import { i18nKey, TranslationKey } from '../../i18n/translations';
import { MailService } from '../../mail/mail.service';
import { DatabaseThrottlerStorage } from '../../rate-limit/database-throttler.storage';
import { ReauthDto } from '../../users/account/dto/account.dto';
import { ReauthService } from '../../users/account/reauth.service';
import { UsersService } from '../../users/users.service';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { AuthService } from '../services/auth.service';
import { PasskeyLoginDto, PasskeyOptionsDto, RegisterPasskeyDto } from './dto/passkey.dto';
import { Passkey } from './entities/passkey.entity';

type Purpose = 'passkey-register' | 'passkey-login';

interface ChallengePayload {
  purpose: Purpose;
  challenge: string;
  sub?: string;
}

const CHALLENGE_TTL = 300; // 5 min para a pessoa tocar no sensor / digitar o PIN
const MAX_PER_USER = 20;

/**
 * Passkeys (WebAuthn): entrar sem senha, com a biometria ou o PIN do aparelho.
 *
 * - O desafio vai para o front num JWT curto (sem tabela), e vale UMA vez (fica marcado no
 *   rate_limits até expirar): uma resposta capturada não serve para entrar de novo.
 * - Pedimos verificação do usuário (biometria/PIN): a passkey prova "algo que você tem" e
 *   "algo que você é/sabe" ao mesmo tempo. Por isso o login com passkey NÃO pede o código do 2FA.
 * - Cadastrar uma passkey é uma nova forma de entrar na conta: pede "confirme que é você"
 *   (senha e 2FA) e avisa por e-mail — um access token roubado não basta para plantar uma.
 */
@Injectable()
export class PasskeyService {
  constructor(
    @InjectRepository(Passkey) private readonly passkeys: Repository<Passkey>,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly reauth: ReauthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly used: DatabaseThrottlerStorage,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  list(userId: string): Promise<Passkey[]> {
    return this.passkeys.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  // ---------------------------------------------------------------- cadastro

  async registrationOptions(userId: string, proof: ReauthDto): Promise<PasskeyOptionsDto> {
    const user = await this.reauth.confirm(userId, proof);
    const existing = await this.list(userId);
    if (existing.length >= MAX_PER_USER) {
      throw new BadRequestException({ key: 'passkeys.limit', args: { max: MAX_PER_USER } });
    }

    const options = await generateRegistrationOptions({
      rpName: this.config.get<string>('app.name', 'NestJS Base'),
      rpID: this.rpId,
      userName: user.email,
      userDisplayName: user.name,
      userID: isoUint8Array.fromUTF8String(user.id),
      attestationType: 'none',
      // O navegador não deixa cadastrar de novo uma passkey que já está na conta
      excludeCredentials: existing.map((p) => ({
        id: p.credentialId,
        transports: this.transports(p),
      })),
      // residentKey: a passkey guarda quem é a pessoa (login sem digitar o e-mail)
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: CHALLENGE_TTL * 1000,
    });
    return {
      options: options as unknown as Record<string, unknown>,
      challengeToken: await this.sign('passkey-register', options.challenge, userId),
    };
  }

  async register(userId: string, dto: RegisterPasskeyDto): Promise<Passkey> {
    const challenge = await this.consume(dto.challengeToken, 'passkey-register', userId);

    let info;
    try {
      const result = await verifyRegistrationResponse({
        response: dto.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpId,
        requireUserVerification: true,
      });
      info = result.verified ? result.registrationInfo : undefined;
    } catch {
      info = undefined;
    }
    if (!info) throw new BadRequestException(i18nKey('passkeys.verificationFailed'));

    const { credential } = info;
    if (await this.passkeys.exists({ where: { credentialId: credential.id } })) {
      throw new BadRequestException(i18nKey('passkeys.alreadyRegistered'));
    }
    if ((await this.passkeys.count({ where: { userId } })) >= MAX_PER_USER) {
      throw new BadRequestException({ key: 'passkeys.limit', args: { max: MAX_PER_USER } });
    }

    const passkey = await this.passkeys.save(
      this.passkeys.create({
        userId,
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports?.length ? credential.transports.join(',') : null,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name: dto.name ?? describeUserAgent(RequestContext.get()?.userAgent),
      }),
    );
    await this.audit.record(AuditAction.AUTH_PASSKEY_ADDED, {
      actorId: userId,
      metadata: { passkey: passkey.id, name: passkey.name },
    });
    await this.mail.sendPasskeyAdded(await this.users.getById(userId), passkey.name);
    return passkey;
  }

  // ---------------------------------------------------------------- login

  async loginOptions(): Promise<PasskeyOptionsDto> {
    // Sem allowCredentials: o navegador mostra as passkeys deste site e a pessoa escolhe
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'required',
      timeout: CHALLENGE_TTL * 1000,
    });
    return {
      options: options as unknown as Record<string, unknown>,
      challengeToken: await this.sign('passkey-login', options.challenge),
    };
  }

  async login(dto: PasskeyLoginDto): Promise<AuthResponseDto> {
    const challenge = await this.consume(dto.challengeToken, 'passkey-login');
    const response = dto.response as unknown as AuthenticationResponseJSON;

    const passkey =
      typeof response.id === 'string' && response.id.length <= 512
        ? await this.passkeys.findOne({ where: { credentialId: response.id } })
        : null;
    // Conta excluída (soft delete) não aparece aqui: a passkey dela não entra
    const user = passkey ? await this.users.findById(passkey.userId) : null;
    if (!passkey || !user) return this.fail(null, 'unknown_passkey');

    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpId,
        credential: {
          id: passkey.credentialId,
          publicKey: isoBase64URL.toBuffer(passkey.publicKey),
          counter: passkey.counter,
          transports: this.transports(passkey),
        },
        requireUserVerification: true,
      });
    } catch {
      verified = undefined;
    }
    if (!verified?.verified) return this.fail(user.id, 'invalid_passkey');

    await this.passkeys.update(passkey.id, {
      counter: verified.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    });
    if (!user.isActive) return this.fail(user.id, 'inactive_user', 'auth.userInactive');
    return this.auth.signInWithPasskey(user);
  }

  // ---------------------------------------------------------------- gerenciar

  async rename(userId: string, id: string, name: string): Promise<Passkey> {
    const passkey = await this.findOwn(userId, id);
    passkey.name = name;
    return this.passkeys.save(passkey);
  }

  async remove(userId: string, id: string): Promise<void> {
    const passkey = await this.findOwn(userId, id);
    await this.passkeys.delete(passkey.id);
    await this.audit.record(AuditAction.AUTH_PASSKEY_REMOVED, {
      actorId: userId,
      metadata: { passkey: passkey.id, name: passkey.name },
    });
  }

  // ---------------------------------------------------------------- internos

  private async findOwn(userId: string, id: string): Promise<Passkey> {
    const passkey = await this.passkeys.findOne({ where: { id, userId } });
    if (!passkey) throw new NotFoundException(i18nKey('passkeys.notFound'));
    return passkey;
  }

  private async fail(
    actorId: string | null,
    reason: string,
    key: TranslationKey = 'passkeys.invalid',
  ): Promise<never> {
    await this.audit.record(AuditAction.AUTH_LOGIN_FAILED, {
      actorId,
      metadata: { method: 'passkey', reason },
    });
    throw new UnauthorizedException(i18nKey(key));
  }

  private sign(purpose: Purpose, challenge: string, sub?: string): Promise<string> {
    const payload: ChallengePayload = { purpose, challenge, ...(sub ? { sub } : {}) };
    return this.jwt.signAsync(payload, {
      secret: this.secret(purpose),
      expiresIn: CHALLENGE_TTL,
    });
  }

  /** Confere o desafio assinado e o "queima": a mesma resposta não é aceita duas vezes. */
  private async consume(token: string, purpose: Purpose, userId?: string): Promise<string> {
    let payload: ChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<ChallengePayload>(token, {
        secret: this.secret(purpose),
      });
    } catch {
      throw new BadRequestException(i18nKey('passkeys.challengeExpired'));
    }
    if (payload.purpose !== purpose || (userId && payload.sub !== userId)) {
      throw new BadRequestException(i18nKey('passkeys.challengeExpired'));
    }
    const { isBlocked } = await this.used.increment(
      `passkey:${payload.challenge}`,
      CHALLENGE_TTL * 1000,
      1,
    );
    if (isBlocked) throw new BadRequestException(i18nKey('passkeys.challengeExpired'));
    return payload.challenge;
  }

  private secret(purpose: Purpose): string {
    return deriveSecret(this.config.getOrThrow<string>('jwt.secret'), purpose);
  }

  private transports(p: Passkey): AuthenticatorTransportFuture[] | undefined {
    return p.transports ? (p.transports.split(',') as AuthenticatorTransportFuture[]) : undefined;
  }

  /** Domínio do site (o do front): a passkey fica presa a ele. */
  private get rpId(): string {
    return this.config.getOrThrow<string>('webauthn.rpId');
  }

  private get origins(): string[] {
    return this.config.getOrThrow<string[]>('webauthn.origins');
  }
}
