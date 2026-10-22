import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, MoreThan, Repository } from 'typeorm';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { i18nKey } from '../i18n/translations';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { Grant } from './entities/grant.entity';

export interface GiveGrant {
  /** Meses a partir de hoje (ou do fim da cortesia que já existe). */
  months?: number;
  /** Ou uma data final. */
  endsAt?: string;
  reason: string;
}

/** Quantos dias antes do fim sai o e-mail "seu Pro de cortesia termina em breve". */
export const ENDING_NOTICE_DAYS = 3;

/** Pro de cortesia: dar, estender e revogar. Quem pode receber é decidido em PaymentsService. */
@Injectable()
export class GrantsService {
  constructor(
    @InjectRepository(Grant) private readonly repo: Repository<Grant>,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  /** A cortesia que vale agora (a que termina mais tarde, se houver mais de uma). */
  active(userId: string): Promise<Grant | null> {
    return this.repo.findOne({
      where: { userId, revokedAt: IsNull(), endsAt: MoreThan(new Date()) },
      order: { endsAt: 'DESC' },
    });
  }

  /** Dá a cortesia, ou estende a que já existe. */
  async give(userId: string, input: GiveGrant, actorId: string): Promise<Grant> {
    if ((input.months === undefined) === (input.endsAt === undefined)) {
      throw new BadRequestException(i18nKey('payments.grantPeriod'));
    }
    const current = await this.active(userId);
    const endsAt =
      input.months !== undefined
        ? addMonths(current?.endsAt ?? new Date(), input.months)
        : new Date(input.endsAt!);
    if (Number.isNaN(endsAt.getTime()) || endsAt <= new Date()) {
      throw new BadRequestException(i18nKey('payments.grantPeriod'));
    }

    const user = await this.users.getById(userId);
    const grant = current ?? this.repo.create({ userId, grantedById: actorId });
    grant.endsAt = endsAt;
    grant.reason = input.reason;
    grant.endingNoticeAt = null; // estendeu: o aviso de fim sai de novo, perto da data nova
    const saved = await this.repo.save(grant);
    await this.audit.record(AuditAction.GRANT_GIVEN, {
      actorId,
      target: { type: 'user', id: userId },
      metadata: {
        grant: saved.id,
        endsAt: endsAt.toISOString(),
        ...(current ? { extended: true } : {}),
      },
    });
    await this.mail.sendCourtesyGiven(user, endsAt, !!current);
    return saved;
  }

  /**
   * Job de manutenção: avisa por e-mail, uma vez, quem tem a cortesia acabando nos próximos
   * ENDING_NOTICE_DAYS dias. Devolve quantos avisos saíram.
   */
  async notifyEnding(now = new Date()): Promise<number> {
    const soon = new Date(now.getTime() + ENDING_NOTICE_DAYS * 86_400_000);
    const grants = await this.repo.find({
      where: { revokedAt: IsNull(), endingNoticeAt: IsNull(), endsAt: Between(now, soon) },
      take: 500,
    });
    let sent = 0;
    for (const grant of grants) {
      const user = await this.users.findById(grant.userId);
      if (user && (await this.mail.sendCourtesyEnding(user, grant.endsAt))) sent++;
      // marca mesmo se o e-mail falhar: melhor um aviso a menos que um por execução
      await this.repo.update({ id: grant.id }, { endingNoticeAt: now });
    }
    return sent;
  }

  async revoke(userId: string, actorId: string): Promise<void> {
    const grant = await this.active(userId);
    if (!grant) throw new NotFoundException(i18nKey('payments.grantNotFound'));
    grant.revokedAt = new Date();
    await this.repo.save(grant);
    await this.audit.record(AuditAction.GRANT_REVOKED, {
      actorId,
      target: { type: 'user', id: userId },
      metadata: { grant: grant.id },
    });
  }
}

/** Mesmo dia, N meses depois (31/jan + 1 = 3/mar, como no calendário do JavaScript). */
function addMonths(from: Date, months: number): Date {
  const date = new Date(from);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}
