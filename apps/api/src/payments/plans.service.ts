import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { i18nKey } from '../i18n/translations';
import type { CreatePlanDto, UpdatePlanDto } from './dto/plans.dto';
import { Plan } from './entities/plan.entity';
import { DEFAULT_PLANS } from './plans';

/** Os planos à venda, editados pelo admin em /admin/plans. */
@Injectable()
export class PlansService implements OnModuleInit {
  private readonly logger = new Logger('Plans');

  constructor(
    @InjectRepository(Plan) private readonly repo: Repository<Plan>,
    private readonly audit: AuditService,
  ) {}

  /** Banco novo: entra com os planos de exemplo. Duas instâncias subindo juntas não duplicam. */
  async onModuleInit(): Promise<void> {
    if (await this.repo.count()) return;
    await this.repo
      .createQueryBuilder()
      .insert()
      .values([...DEFAULT_PLANS])
      .orIgnore()
      .execute();
    this.logger.log(`planos de exemplo criados: ${DEFAULT_PLANS.map((p) => p.id).join(', ')}`);
  }

  /** Todos, na ordem da tela. */
  list(): Promise<Plan[]> {
    return this.repo.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  /** Um plano, à venda ou não (compras antigas apontam para ele). */
  find(id: string): Promise<Plan | null> {
    return this.repo.findOneBy({ id });
  }

  async listActive(): Promise<Plan[]> {
    return (await this.list()).filter((p) => p.active);
  }

  /** Um plano à venda (para comprar). */
  async findActive(id: string): Promise<Plan> {
    const plan = await this.repo.findOneBy({ id });
    if (!plan?.active) throw new NotFoundException(i18nKey('payments.planNotFound'));
    return plan;
  }

  async create(dto: CreatePlanDto, actorId: string): Promise<Plan> {
    if (await this.repo.existsBy({ id: dto.id })) {
      throw new ConflictException(i18nKey('payments.planExists'));
    }
    const plan = await this.repo.save(
      this.repo.create({
        ...dto,
        interval: dto.kind === 'subscription' ? (dto.interval ?? 'month') : null,
        currency: 'BRL',
        descriptionEn: dto.descriptionEn ?? '',
        descriptionPt: dto.descriptionPt ?? '',
      }),
    );
    await this.audit.record(AuditAction.PLAN_CREATED, {
      actorId,
      target: { type: 'plan', id: plan.id },
      metadata: { amount: plan.amount, kind: plan.kind },
    });
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto, actorId: string): Promise<Plan> {
    const plan = await this.repo.findOneBy({ id });
    if (!plan) throw new NotFoundException(i18nKey('payments.planNotFound'));
    // Só o que mudou vai para a auditoria; no preço, o antigo junto ("de quanto para quanto")
    const changes = Object.fromEntries(
      Object.entries(dto).filter(
        ([key, value]) => value !== undefined && value !== plan[key as keyof Plan],
      ),
    );
    if (!Object.keys(changes).length) return plan;
    const before = plan.amount;
    Object.assign(plan, changes);
    const saved = await this.repo.save(plan);
    await this.audit.record(AuditAction.PLAN_UPDATED, {
      actorId,
      target: { type: 'plan', id },
      metadata: {
        fields: Object.keys(changes),
        ...('amount' in changes ? { from: before, to: saved.amount } : {}),
      },
    });
    return saved;
  }

  /** Guarda o produto que a API criou numa plataforma para este plano (e este preço). */
  async rememberProduct(
    planId: string,
    provider: string,
    key: string,
    productId: string,
  ): Promise<void> {
    const plan = await this.repo.findOneByOrFail({ id: planId });
    const all = plan.providerProducts ?? {};
    all[provider] = { ...all[provider], [key]: productId };
    await this.repo.update({ id: planId }, { providerProducts: all });
  }
}
