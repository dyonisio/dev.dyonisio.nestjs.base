import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import type { PlanKind } from '../plans';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded';

/**
 * Uma compra (ou a primeira cobrança de uma assinatura): nasce `pending` quando a pessoa vai
 * para o checkout da plataforma e vira `paid` quando a API CONFIRMA com a plataforma.
 */
@Entity({ name: 'payments' })
export class Payment {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_payments_id' })
  id: string;

  @Index('IDX_payments_userId')
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_payments_userId' })
  user?: User;

  /** O plano do catálogo (plans.ts). */
  @Column({ type: 'varchar', length: 40 })
  planId: string;

  @Column({ type: 'varchar', length: 20 })
  kind: PlanKind;

  /** stripe | infinitepay | abacatepay */
  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: PaymentStatus;

  /** Em centavos, gravado na hora da compra (o catálogo pode mudar depois). */
  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  /** O id da cobrança na plataforma (sessão da Stripe, checkout da AbacatePay, slug da InfinitePay). */
  @Index('IDX_payments_providerRef')
  @Column({ type: 'varchar', length: 255, nullable: true })
  providerRef: string | null;

  @Column({ type: Date, nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
