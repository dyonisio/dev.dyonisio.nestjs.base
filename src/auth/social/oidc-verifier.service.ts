import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { createRemoteJWKSet, JWTPayload, jwtVerify, JWTVerifyGetKey } from 'jose';
import configuration from '../../config/configuration';
import { i18nKey } from '../../i18n/translations';

export const SOCIAL_PROVIDERS = ['google', 'apple'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

type SocialConfig = ReturnType<typeof configuration>['social'];

/** Onde cada provedor publica as chaves públicas e quem ele diz ser no token. */
const PROVIDERS: Record<SocialProvider, { issuer: string[]; jwksUri: string }> = {
  google: {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  apple: {
    issuer: ['https://appleid.apple.com'],
    jwksUri: 'https://appleid.apple.com/auth/keys',
  },
};

export interface SocialProfile {
  provider: SocialProvider;
  /** Id estável do usuário no provedor ("sub"). */
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Busca (e mantém em cache) as chaves públicas de um provedor. Separado em uma classe
 * própria para os testes trocarem por chaves locais, sem acessar a internet.
 */
@Injectable()
export class JwksResolver {
  private readonly cache = new Map<string, JWTVerifyGetKey>();

  resolve(jwksUri: string): JWTVerifyGetKey {
    let keySet = this.cache.get(jwksUri);
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(jwksUri), { cacheMaxAge: 60 * 60 * 1000 });
      this.cache.set(jwksUri, keySet);
    }
    return keySet;
  }
}

/**
 * Valida o ID token (OpenID Connect) que o frontend recebeu do Google/Apple:
 * assinatura (chaves públicas do provedor), emissor, destinatário (os client IDs
 * do SEU app — sem isso, um token emitido para outro app seria aceito) e validade.
 */
@Injectable()
export class OidcVerifier {
  constructor(
    private readonly config: ConfigService,
    private readonly jwks: JwksResolver,
  ) {}

  /** Provedores com client ID configurado. */
  enabledProviders(): SocialProvider[] {
    return SOCIAL_PROVIDERS.filter((p) => this.clientIds(p).length > 0);
  }

  async verify(provider: SocialProvider, idToken: string, nonce?: string): Promise<SocialProfile> {
    const audience = this.clientIds(provider);
    if (audience.length === 0) {
      throw new BadRequestException(i18nKey('social.providerNotConfigured'));
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks.resolve(PROVIDERS[provider].jwksUri), {
        issuer: PROVIDERS[provider].issuer,
        audience,
        algorithms: ['RS256'], // Google e Apple assinam com RS256
        clockTolerance: 30,
      }));
    } catch {
      throw new UnauthorizedException(i18nKey('social.invalidToken'));
    }

    // Nonce: se o app enviou um, o token tem que ter sido emitido para ESTA tentativa
    // (o Google devolve o nonce puro; a Apple, o SHA-256 dele).
    if (nonce !== undefined) {
      const hashed = createHash('sha256').update(nonce).digest('hex');
      if (payload.nonce !== nonce && payload.nonce !== hashed) {
        throw new UnauthorizedException(i18nKey('social.invalidToken'));
      }
    }
    if (!payload.sub) throw new UnauthorizedException(i18nKey('social.invalidToken'));

    return {
      provider,
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : undefined,
      // A Apple manda "true" (string); o Google, true (boolean)
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  }

  private clientIds(provider: SocialProvider): string[] {
    return this.config.get<SocialConfig>('social')?.[provider].clientIds ?? [];
  }
}
