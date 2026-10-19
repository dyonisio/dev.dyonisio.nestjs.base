import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../common/crypto/password-hash';
import { Role } from '../common/enums/role.enum';
import { RequestContext } from '../common/request-context/request-context';
import { FilesService } from '../files/files.service';
import { i18nKey } from '../i18n/translations';
import { MailService } from '../mail/mail.service';
import { SessionRevokeReason } from '../sessions/entities/session.entity';
import { SessionService } from '../sessions/session.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto, PaginatedUsersDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EmailVerificationService } from './email-verification.service';
import { User } from './entities/user.entity';

/** Escapa curingas do LIKE: o que o usuário digita é procurado literalmente. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const AUDITED_FIELDS = ['name', 'email', 'isActive', 'locale'] as const;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly mailService: MailService,
    private readonly emailVerification: EmailVerificationService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  async findAll({
    page,
    limit,
    role,
    search,
    sortBy,
    order,
    deleted,
  }: ListUsersQueryDto): Promise<PaginatedUsersDto> {
    const qb = this.repo.createQueryBuilder('user');

    if (deleted) qb.withDeleted().andWhere('user.deletedAt IS NOT NULL');
    if (role) qb.andWhere('user.role = :role', { role });
    if (search) {
      // LOWER + LIKE funciona igual no Postgres e no SQLite (testes)
      qb.andWhere(
        "(LOWER(user.name) LIKE :search ESCAPE '\\' OR LOWER(user.email) LIKE :search ESCAPE '\\')",
        { search: `%${escapeLike(search.toLowerCase())}%` },
      );
    }

    // Texto ordenado sem diferenciar maiúsculas ("bruno" não vai para depois de "Zeca")
    const sortExpr = sortBy === 'createdAt' ? 'user.createdAt' : `LOWER(user.${sortBy})`;

    const [data, total] = await qb
      .orderBy(sortExpr, order === 'asc' ? 'ASC' : 'DESC')
      // Desempate estável: a paginação não repete nem pula registros com valores iguais
      .addOrderBy('user.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /** Retorna null se não existir (ou se foi excluído). */
  /**
   * Conta sem idioma salvo (ex.: o admin do seed) passa a usar o idioma em que a pessoa entrou.
   * Só preenche se estiver vazio: nunca sobrescreve uma escolha feita em "Minha conta".
   */
  async adoptLocale(id: string, lang: string): Promise<boolean> {
    const result = await this.repo.update({ id, locale: IsNull() }, { locale: lang });
    return !!result.affected;
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Lança 404 se não existir (ou se foi excluído). */
  async getById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(i18nKey('users.notFound'));
    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  /** Conta criada por login social: e-mail já verificado pelo provedor e sem senha. */
  async createFromProvider(data: { name: string; email: string; locale?: string }): Promise<User> {
    const email = data.email.trim().toLowerCase();
    await this.ensureEmailAvailable(email);
    return this.repo.save(
      this.repo.create({
        name: data.name.slice(0, 120),
        email,
        role: Role.USER,
        password: null,
        emailVerifiedAt: new Date(),
        locale: data.locale ?? RequestContext.get()?.lang ?? null,
      }),
    );
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.repo.update(id, { emailVerifiedAt: new Date() });
  }

  /**
   * O dono real do e-mail (provado pelo Google/Apple) assume uma conta que NUNCA foi
   * confirmada. Quem a criou pode ter sido outra pessoa ("pré-sequestro": cadastrar o e-mail
   * da vítima antes dela). Então tudo que esse criador poderia ter deixado é descartado:
   * senha, 2FA e sessões abertas. O dono define uma senha depois, se quiser.
   */
  async claimUnverifiedAccount(id: string): Promise<void> {
    await this.repo.update(id, {
      emailVerifiedAt: new Date(),
      password: null,
      twoFactorEnabledAt: null,
      twoFactorSecret: null,
      twoFactorLastStep: null,
      twoFactorRecoveryCodes: null,
    });
    await this.sessions.revokeAllForUser(id, SessionRevokeReason.ACCOUNT_CLAIMED);
  }

  /** Busca incluindo o hash da senha (para login / troca de senha). */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }

  findByIdWithPassword(id: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id })
      .getOne();
  }

  /**
   * @param options.emailVerified true para usuários criados por um admin (o admin
   *   responde pelo e-mail); false no auto-cadastro, que exige confirmação por link.
   * @param options.audit false quando quem chama registra a auditoria (ex.: auto-cadastro).
   */
  async create(
    dto: Omit<CreateUserDto, 'password'> & { password?: string },
    options: { emailVerified?: boolean; audit?: boolean } = {},
  ): Promise<User> {
    const email = dto.email.trim().toLowerCase();
    await this.ensureEmailAvailable(email);

    const user = await this.repo.save(
      this.repo.create({
        name: dto.name,
        email,
        role: dto.role ?? Role.USER,
        // Sem senha = convite: a pessoa cria a senha pelo link enviado por e-mail
        password: dto.password ? await hashPassword(dto.password) : null,
        emailVerifiedAt: options.emailVerified ? new Date() : null,
        // Idioma dos e-mails: o informado ou o da requisição (Accept-Language)
        locale: dto.locale ?? RequestContext.get()?.lang ?? null,
      }),
    );

    if (options.audit !== false) {
      await this.audit.record(AuditAction.USER_CREATED, {
        target: { type: 'user', id: user.id },
        metadata: { email: user.email, role: user.role },
      });
    }
    return user;
  }

  /**
   * Trocar o e-mail exige nova confirmação (o link vai para o endereço novo).
   * Desativar o usuário encerra todas as sessões dele na hora.
   */
  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.getById(id);
    const emailChanged = !!dto.email && dto.email !== user.email;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of AUDITED_FIELDS) {
      if (dto[field] !== undefined && dto[field] !== user[field]) {
        changes[field] = { from: user[field], to: dto[field] };
      }
    }

    // O e-mail NÃO muda aqui: vira um pedido de troca (pendingEmail), igual ao feito pelo próprio
    // usuário. A conta continua com o endereço atual até o novo ser confirmado pelo link — um
    // endereço digitado errado nunca é confirmado, então não entrega a conta a um estranho.
    const { email: newEmail, ...rest } = dto;
    if (emailChanged) {
      await this.ensureEmailAvailable(newEmail!);
      delete changes.email; // o que mudou foi só o pedido (auditado como email_change_requested)
    }
    Object.assign(user, rest);
    const saved = await this.repo.save(user);

    if (emailChanged) await this.emailVerification.requestChange(saved, newEmail!, 'admin');
    if (changes.isActive?.to === false) {
      await this.sessions.revokeAllForUser(id, SessionRevokeReason.USER_DISABLED);
    }
    if (Object.keys(changes).length > 0) {
      await this.audit.record(AuditAction.USER_UPDATED, {
        target: { type: 'user', id },
        metadata: { changes },
      });
    }
    return saved;
  }

  async updateRole(id: string, role: Role, actorId?: string): Promise<User> {
    if (id === actorId) {
      throw new BadRequestException(i18nKey('users.cannotChangeOwnRole'));
    }
    const user = await this.getById(id);
    if (user.role === role) return user;

    const oldRole = user.role;
    user.role = role;
    const saved = await this.repo.save(user);
    await this.mailService.sendRoleChanged(saved, oldRole, role);
    await this.audit.record(AuditAction.USER_ROLE_CHANGED, {
      target: { type: 'user', id },
      metadata: { from: oldRole, to: role },
    });
    return saved;
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    await this.repo.update(id, { password: await hashPassword(newPassword) });
  }

  /** Soft delete: o registro fica (restaurável), as sessões caem na hora e o e-mail é liberado. */
  async remove(id: string, actorId?: string): Promise<void> {
    if (id === actorId) {
      throw new BadRequestException(i18nKey('users.cannotDeleteSelf'));
    }
    const user = await this.getById(id);
    await this.repo.softRemove(user);
    await this.sessions.revokeAllForUser(id, SessionRevokeReason.USER_DELETED);
    await this.audit.record(AuditAction.USER_DELETED, {
      target: { type: 'user', id },
      metadata: { email: user.email },
    });
  }

  /** Desfaz o soft delete — se o e-mail não tiver sido usado por outra conta nesse meio-tempo. */
  async restore(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id }, withDeleted: true });
    if (!user?.deletedAt) throw new NotFoundException(i18nKey('users.notFound'));
    if (user.anonymizedAt) throw new BadRequestException(i18nKey('users.anonymized'));

    await this.ensureEmailAvailable(user.email);
    await this.repo.restore(id);
    await this.audit.record(AuditAction.USER_RESTORED, { target: { type: 'user', id } });
    return this.getById(id);
  }

  /** Define o avatar a partir de um upload concluído (finalidade "avatar") e apaga o anterior. */
  async setAvatar(userId: string, fileId: string): Promise<User> {
    const file = await this.files.consume(userId, fileId, 'avatar');
    const user = await this.getById(userId);
    const previous = user.avatarFileId;

    user.avatarFileId = file.id;
    user.avatarUrl = this.files.publicUrl(file);
    const saved = await this.repo.save(user);

    if (previous && previous !== file.id) await this.files.removeById(previous);
    await this.audit.record(AuditAction.USER_AVATAR_CHANGED, {
      target: { type: 'user', id: userId },
    });
    return saved;
  }

  async removeAvatar(userId: string): Promise<User> {
    const user = await this.getById(userId);
    const previous = user.avatarFileId;
    user.avatarFileId = null;
    user.avatarUrl = null;
    const saved = await this.repo.save(user);
    if (previous) await this.files.removeById(previous);
    return saved;
  }

  /** Só considera usuários não excluídos (o mesmo critério do índice único parcial). */
  private async ensureEmailAvailable(email: string) {
    if (await this.repo.exists({ where: { email } })) {
      throw new ConflictException(i18nKey('users.emailTaken'));
    }
  }
}
