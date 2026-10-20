import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { Repository } from 'typeorm';
import { deriveSecret } from '../../common/crypto/derive-secret';
import { i18nKey } from '../../i18n/translations';
import { DatabaseThrottlerStorage } from '../../rate-limit/database-throttler.storage';
import { PasskeyOptionsDto, PasskeyProofDto } from './dto/passkey.dto';
import { Passkey } from './entities/passkey.entity';

export type PasskeyPurpose = 'passkey-register' | 'passkey-login' | 'passkey-reauth';

interface ChallengePayload {
  purpose: PasskeyPurpose;
  challenge: string;
  sub?: string;
}

/** 5 min para a pessoa tocar no sensor / digitar o PIN. */
export const CHALLENGE_TTL = 300;

/**
 * O "miolo" das passkeys: desafios de uso único e conferência de assinaturas. Sem depender de
 * usuários nem de sessões, para poder ser usado tanto no login (AuthModule) quanto no
 * "confirme que é você" (UsersModule) sem ciclo entre os módulos.
 */
@Injectable()
export class PasskeyVerifier {
  constructor(
    @InjectRepository(Passkey) private readonly passkeys: Repository<Passkey>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly used: DatabaseThrottlerStorage,
  ) {}

  /** Domínio do site (o do front): a passkey fica presa a ele. */
  get rpId(): string {
    return this.config.getOrThrow<string>('webauthn.rpId');
  }

  get origins(): string[] {
    return this.config.getOrThrow<string[]>('webauthn.origins');
  }

  transports(p: Passkey): AuthenticatorTransportFuture[] | undefined {
    return p.transports ? (p.transports.split(',') as AuthenticatorTransportFuture[]) : undefined;
  }

  sign(purpose: PasskeyPurpose, challenge: string, sub?: string): Promise<string> {
    const payload: ChallengePayload = { purpose, challenge, ...(sub ? { sub } : {}) };
    return this.jwt.signAsync(payload, { secret: this.secret(purpose), expiresIn: CHALLENGE_TTL });
  }

  /** Confere o desafio assinado e o "queima": a mesma resposta não é aceita duas vezes. */
  async consume(token: string, purpose: PasskeyPurpose, userId?: string): Promise<string> {
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

  /** A passkey de onde veio a resposta (pelo id da credencial), opcionalmente só de um usuário. */
  findByResponse(response: AuthenticationResponseJSON, userId?: string): Promise<Passkey | null> {
    if (typeof response?.id !== 'string' || response.id.length > 512) return Promise.resolve(null);
    return this.passkeys.findOne({
      where: { credentialId: response.id, ...(userId ? { userId } : {}) },
    });
  }

  /**
   * Confere a assinatura (com verificação do usuário: biometria/PIN) e o contador contra
   * clonagem. Se valer, registra o uso. Nunca lança: devolve se valeu.
   */
  async verify(
    passkey: Passkey,
    response: AuthenticationResponseJSON,
    challenge: string,
  ): Promise<boolean> {
    let result;
    try {
      result = await verifyAuthenticationResponse({
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
      return false;
    }
    if (!result.verified) return false;
    await this.passkeys.update(passkey.id, {
      counter: result.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    });
    return true;
  }

  // ---------------------------------------------------------------- "confirme que é você"

  /** Opções para confirmar com uma passkey da PRÓPRIA conta (o navegador só oferece essas). */
  async reauthOptions(userId: string): Promise<PasskeyOptionsDto> {
    const own = await this.passkeys.find({ where: { userId } });
    if (!own.length) throw new BadRequestException(i18nKey('passkeys.none'));
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'required',
      allowCredentials: own.map((p) => ({ id: p.credentialId, transports: this.transports(p) })),
      timeout: CHALLENGE_TTL * 1000,
    });
    return {
      options: options as unknown as Record<string, unknown>,
      challengeToken: await this.sign('passkey-reauth', options.challenge, userId),
    };
  }

  /**
   * Prova de identidade com passkey: precisa ser uma passkey da conta, assinando um desafio
   * emitido para ela. Vale como senha + 2FA (a passkey já prova os dois fatores).
   */
  async confirmReauth(userId: string, proof: PasskeyProofDto): Promise<void> {
    const challenge = await this.consume(proof.challengeToken, 'passkey-reauth', userId);
    const response = proof.response as unknown as AuthenticationResponseJSON;
    const passkey = await this.findByResponse(response, userId);
    if (!passkey || !(await this.verify(passkey, response, challenge))) {
      throw new BadRequestException(i18nKey('passkeys.verificationFailed'));
    }
  }

  private secret(purpose: PasskeyPurpose): string {
    return deriveSecret(this.config.getOrThrow<string>('jwt.secret'), purpose);
  }
}
