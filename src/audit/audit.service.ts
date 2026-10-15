import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, LessThan, Repository } from 'typeorm';
import { RequestContext } from '../common/request-context/request-context';
import { AuditAction, AuditTargetType } from './audit-action.enum';
import { AuditLog } from './audit-log.entity';
import { ListAuditLogsQueryDto, PaginatedAuditLogsDto } from './dto/list-audit-logs-query.dto';

export interface AuditRecordOptions {
  /** Quem fez. Padrão: o usuário autenticado da requisição. `null` = anônimo. */
  actorId?: string | null;
  target?: { type: AuditTargetType; id: string };
  /** Detalhes da ação. NUNCA coloque senhas, tokens ou hashes aqui. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  /**
   * Registra um evento. IP, user agent e requestId vêm do contexto da requisição.
   * Falhas são logadas e engolidas: a auditoria nunca derruba a ação do usuário.
   */
  async record(action: AuditAction, options: AuditRecordOptions = {}): Promise<void> {
    const ctx = RequestContext.get();
    try {
      await this.repo.save(
        this.repo.create({
          action,
          actorId: options.actorId === undefined ? (ctx?.userId ?? null) : options.actorId,
          targetType: options.target?.type ?? null,
          targetId: options.target?.id ?? null,
          metadata: options.metadata ?? null,
          ip: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
          // Horário pela aplicação (precisão de ms) — o padrão do SQLite só tem segundos,
          // o que embaralharia a ordem de eventos próximos
          createdAt: new Date(),
        }),
      );
    } catch (error) {
      this.logger.error(
        `Falha ao registrar auditoria "${action}": ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /** Eventos feitos pelo usuário ou sobre ele (exportação de dados). */
  listForUser(userId: string): Promise<AuditLog[]> {
    return this.repo.find({
      where: [{ actorId: userId }, { targetType: 'user', targetId: userId }],
      order: { createdAt: 'DESC' },
      take: 5000,
    });
  }

  /**
   * Anonimização de uma conta: mantém O QUE aconteceu (ação e data, úteis para segurança),
   * mas apaga os dados pessoais dos registros dela — IP, navegador e detalhes (que podem ter e-mail).
   */
  async anonymizeForUser(userId: string): Promise<void> {
    const scopes: FindOptionsWhere<AuditLog>[] = [
      { actorId: userId },
      { targetType: 'user', targetId: userId },
    ];
    for (const where of scopes) {
      await this.repo.update(where, { ip: null, userAgent: null, metadata: null });
    }
  }

  /** Retenção: apaga registros mais antigos que `before`. */
  async purgeOlderThan(before: Date): Promise<number> {
    return (await this.repo.delete({ createdAt: LessThan(before) })).affected ?? 0;
  }

  async findAll({
    page,
    limit,
    action,
    actorId,
    targetId,
  }: ListAuditLogsQueryDto): Promise<PaginatedAuditLogsDto> {
    const qb = this.repo.createQueryBuilder('log');
    if (action) qb.andWhere('log.action = :action', { action });
    if (actorId) qb.andWhere('log.actorId = :actorId', { actorId });
    if (targetId) qb.andWhere('log.targetId = :targetId', { targetId });

    const [data, total] = await qb
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
