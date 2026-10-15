import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/request-context/request-context';
import { i18nKey } from '../i18n/translations';
import { User } from '../users/entities/user.entity';
import { AuthTokensDto } from '../auth/dto/auth-response.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { Session, SessionRevokeReason } from './entities/session.entity';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Ciclo de vida das sessões e dos tokens:
 *  - create:  login/cadastro abre uma sessão e emite o primeiro par de tokens
 *  - refresh: rotação — o refresh token é consumido e outro é emitido na mesma sessão
 *  - reuso de refresh token já consumido => a sessão é revogada (token roubado)
 *  - revogar a sessão invalida na hora também os access tokens dela (via `sid` no JWT)
 */
@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(RefreshToken) private readonly tokens: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async create(user: User): Promise<AuthTokensDto> {
    // Faxina: remove sessões expiradas do usuário (e seus tokens, via cascade)
    await this.sessions.delete({ userId: user.id, expiresAt: LessThan(new Date()) });

    const ctx = RequestContext.get();
    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        expiresAt: this.nextExpiry(),
        revokedAt: null,
        revokedReason: null,
        userAgent: ctx?.userAgent ?? null,
        ip: ctx?.ip ?? null,
        lastUsedAt: new Date(),
      }),
    );
    return this.issue(session, user);
  }

  async refresh(refreshToken: string): Promise<{ user: User; tokens: AuthTokensDto }> {
    const invalid = new UnauthorizedException(i18nKey('auth.invalidRefreshToken'));

    const token = await this.findToken(refreshToken);
    const session = token?.session;
    if (!token || !session?.user) throw invalid;

    if (token.usedAt) {
      await this.reuseDetected(session);
      throw invalid;
    }
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw invalid;
    if (!session.user.isActive) throw invalid;

    // Update condicional: em requisições concorrentes com o mesmo token, só uma vence
    const result = await this.tokens.update(
      { id: token.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (result.affected === 0) {
      await this.reuseDetected(session);
      throw invalid;
    }

    await this.sessions.update(session.id, {
      expiresAt: this.nextExpiry(session.createdAt),
      lastUsedAt: new Date(),
      ip: RequestContext.get()?.ip ?? session.ip,
    });
    return { user: session.user, tokens: await this.issue(session, session.user) };
  }

  /**
   * Logout: revoga a sessão do refresh token informado. Silencioso se não existir.
   * Retorna o id do usuário dono da sessão (para auditoria) ou null.
   */
  async revoke(refreshToken: string): Promise<string | null> {
    const token = await this.findToken(refreshToken);
    if (!token) return null;
    await this.revokeSession(token.sessionId, SessionRevokeReason.LOGOUT);
    return token.session?.userId ?? null;
  }

  /** Encerra todas as sessões ativas do usuário (ex.: troca/redefinição de senha). */
  async revokeAllForUser(
    userId: string,
    reason: SessionRevokeReason = SessionRevokeReason.PASSWORD_CHANGED,
  ): Promise<void> {
    await this.sessions.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  /**
   * Usado pelo JwtStrategy a cada requisição: uma única query (sessão + usuário).
   * Retorna null se a sessão foi revogada ou o usuário está inativo/removido.
   */
  async findActiveUser(sessionId: string | undefined): Promise<User | null> {
    if (!sessionId || !isUUID(sessionId)) return null;

    const session = await this.sessions.findOne({
      where: { id: sessionId },
      relations: { user: true },
    });
    if (!session || session.revokedAt || !session.user?.isActive) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session.user;
  }

  findById(sessionId: string | undefined): Promise<Session | null> {
    if (!sessionId || !isUUID(sessionId)) return Promise.resolve(null);
    return this.sessions.findOne({ where: { id: sessionId } });
  }

  /**
   * O login vem de um dispositivo novo? = a conta já tem histórico de sessões, mas nenhuma
   * com este user agent. A primeira sessão da conta (cadastro) não conta como "novo".
   * O histórico é o da tabela sessions (encerradas ficam SESSIONS_RETENTION_DAYS dias).
   */
  async isNewDevice(userId: string, userAgent: string | null | undefined): Promise<boolean> {
    const known = await this.sessions.find({ where: { userId }, select: { userAgent: true } });
    return known.length > 0 && !known.some((s) => s.userAgent === (userAgent ?? null));
  }

  /** Apaga todas as sessões do usuário (anonimização da conta: IPs e dispositivos saem junto). */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.sessions.delete({ userId });
  }

  /** Todas as sessões do usuário (inclusive encerradas) — para a exportação de dados. */
  listAllForUser(userId: string): Promise<Session[]> {
    return this.sessions.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Manutenção: apaga sessões encerradas/expiradas há mais de `retentionDays` (com seus
   * refresh tokens) e refresh tokens já usados que nem existiriam mais (mais velhos que a
   * validade do refresh). Retorna quantos registros saíram.
   */
  async purge(retentionDays: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const sessions = await this.sessions.delete([
      { revokedAt: LessThan(cutoff) },
      { expiresAt: LessThan(cutoff) },
    ]);
    const tokens = await this.tokens.delete({
      usedAt: LessThan(new Date(now.getTime() - this.refreshExpiresIn * 1000)),
    });
    return (sessions.affected ?? 0) + (tokens.affected ?? 0);
  }

  /** Sessões ativas do usuário ("meus dispositivos"), usadas mais recentemente primeiro. */
  listActive(userId: string): Promise<Session[]> {
    return this.sessions.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { lastUsedAt: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * O próprio usuário encerra UMA sessão sua. Retorna false se não existir,
   * já estiver encerrada ou for de outro usuário (não revela qual dos casos).
   */
  async revokeOwn(userId: string, sessionId: string): Promise<boolean> {
    if (!isUUID(sessionId)) return false;
    const result = await this.sessions.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: SessionRevokeReason.REVOKED_BY_USER },
    );
    return (result.affected ?? 0) > 0;
  }

  /** "Sair de todos os outros dispositivos": encerra tudo, menos a sessão atual. */
  async revokeOthers(userId: string, currentSessionId: string): Promise<number> {
    const result = await this.sessions.update(
      { userId, revokedAt: IsNull(), id: Not(currentSessionId) },
      { revokedAt: new Date(), revokedReason: SessionRevokeReason.REVOKED_BY_USER },
    );
    return result.affected ?? 0;
  }

  /** Refresh token já usado foi apresentado de novo: provável roubo. Derruba a sessão e audita. */
  private async reuseDetected(session: Session): Promise<void> {
    await this.revokeSession(session.id, SessionRevokeReason.REUSE_DETECTED);
    await this.audit.record(AuditAction.AUTH_REFRESH_TOKEN_REUSE, {
      actorId: session.userId,
      target: { type: 'session', id: session.id },
    });
  }

  private async revokeSession(id: string, reason: SessionRevokeReason): Promise<void> {
    await this.sessions.update(
      { id, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  private async issue(session: Session, user: User): Promise<AuthTokensDto> {
    const secret = randomBytes(48).toString('base64url');
    const token = await this.tokens.save(
      this.tokens.create({ sessionId: session.id, tokenHash: sha256(secret), usedAt: null }),
    );

    const payload: JwtPayload = {
      sub: user.id,
      sid: session.id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      refreshToken: `${token.id}.${secret}`,
      tokenType: 'Bearer',
      expiresIn: this.config.get<number>('jwt.expiresIn', 900),
      refreshExpiresIn: this.refreshExpiresIn,
    };
  }

  private async findToken(refreshToken: string): Promise<RefreshToken | null> {
    const [id, secret] = refreshToken.split('.');
    if (!id || !secret || !isUUID(id)) return null;

    const token = await this.tokens.findOne({
      where: { id },
      relations: { session: { user: true } },
    });
    if (!token) return null;

    const expected = Buffer.from(token.tokenHash, 'hex');
    const received = Buffer.from(sha256(secret), 'hex');
    return timingSafeEqual(expected, received) ? token : null;
  }

  private get refreshExpiresIn(): number {
    return this.config.get<number>('jwt.refreshExpiresIn', 2592000);
  }

  /**
   * Janela deslizante (cada refresh renova), limitada pela idade máxima da sessão
   * (SESSION_MAX_AGE_DAYS): mesmo usada todo dia, uma sessão não vive para sempre.
   */
  private nextExpiry(createdAt = new Date()): Date {
    const sliding = Date.now() + this.refreshExpiresIn * 1000;
    const maxAge = this.config.get<number>('session.maxAgeDays', 90) * 86_400_000;
    return new Date(Math.min(sliding, createdAt.getTime() + maxAge));
  }
}
