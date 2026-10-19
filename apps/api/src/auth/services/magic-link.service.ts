import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { deriveSecret } from '../../common/crypto/derive-secret';
import { RequestContext } from '../../common/request-context/request-context';
import { describeUserAgent } from '../../common/utils/user-agent';
import { i18nKey } from '../../i18n/translations';
import { MailService } from '../../mail/mail.service';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { AuthService, LoginResult } from './auth.service';

interface MagicLinkPayload {
  sub: string;
  purpose: 'magic-link';
  /** O e-mail para o qual o link foi enviado: se a conta trocar de e-mail, o link morre */
  email: string;
  /** Precisa bater com users.magicLinkNonce (uso único, só o link mais novo vale) */
  nonce: string;
}

/**
 * Login por link mágico: a pessoa informa o e-mail e entra pelo link que chega nele.
 *
 * Por que digitar só o e-mail NÃO basta para entrar:
 *  - o pedido nunca abre sessão: só manda o link para o e-mail da conta (a prova é ter acesso à caixa);
 *  - a resposta do pedido é a mesma exista o e-mail ou não (não revela quem tem conta);
 *  - o link é assinado com um segredo próprio desta finalidade, vale 15 min e uma única vez
 *    (o nonce é consumido numa UPDATE atômica: dois cliques ao mesmo tempo, só um entra);
 *  - pedir outro link invalida o anterior; trocar o e-mail da conta também;
 *  - com 2FA ativo, o link leva ao desafio do código, como o login por senha;
 *  - limites por IP e por e-mail (@AuthRateLimit) impedem usar o pedido para lotar a caixa de alguém.
 */
@Injectable()
export class MagicLinkService {
  constructor(
    private readonly users: UsersService,
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async request(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) return; // mesma resposta: não revela se o e-mail existe

    const nonce = randomBytes(16).toString('hex');
    await this.repo.update(user.id, { magicLinkNonce: nonce }); // o link anterior deixa de valer

    const expiresIn = this.expiresIn();
    const payload: MagicLinkPayload = {
      sub: user.id,
      purpose: 'magic-link',
      email: user.email,
      nonce,
    };
    const token = await this.jwt.signAsync(payload, { secret: this.secret(), expiresIn });

    const ctx = RequestContext.get();
    await this.mail.sendMagicLink(user, {
      url: `${this.config.get<string>('app.frontendUrl')}/magic-link?token=${encodeURIComponent(token)}`,
      expiresInMinutes: Math.round(expiresIn / 60),
      device: describeUserAgent(ctx?.userAgent),
      ip: ctx?.ip ?? null,
    });
    await this.audit.record(AuditAction.AUTH_MAGIC_LINK_SENT, { actorId: user.id });
  }

  /** Troca o link pela sessão (ou pelo desafio do 2FA). */
  async verify(token: string): Promise<LoginResult> {
    const invalid = new BadRequestException(i18nKey('auth.invalidMagicLink'));

    let payload: MagicLinkPayload;
    try {
      payload = await this.jwt.verifyAsync<MagicLinkPayload>(token, { secret: this.secret() });
    } catch {
      throw invalid;
    }
    if (payload.purpose !== 'magic-link' || !payload.nonce) throw invalid;

    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive || user.email !== payload.email) throw invalid;

    // Uso único e atômico: só quem apagar o nonce entra
    const consumed = await this.repo.update(
      { id: user.id, magicLinkNonce: payload.nonce },
      { magicLinkNonce: null },
    );
    if (!consumed.affected) throw invalid;

    // Abrir o link prova que a pessoa controla o e-mail. Conta nunca confirmada pode ter sido
    // criada por outra pessoa com este e-mail (pré-sequestro): a senha, o 2FA e as sessões de
    // quem a criou são descartados, como no login social.
    if (!user.emailVerifiedAt) await this.users.claimUnverifiedAccount(user.id);

    const fresh = (await this.users.findById(user.id))!;
    return this.auth.completeLogin(fresh, 'magic-link');
  }

  private secret(): string {
    return deriveSecret(this.config.getOrThrow<string>('jwt.secret'), 'magic-link');
  }

  private expiresIn(): number {
    return this.config.get<number>('jwt.magicLinkExpiresIn', 900);
  }
}
