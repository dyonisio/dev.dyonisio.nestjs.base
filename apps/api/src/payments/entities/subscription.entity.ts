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

/** active (em dia) | past_due (cobrança falhou, a plataforma ainda tenta) | canceled */
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled';

/** Uma assinatura recorrente, espelhando o que a plataforma informa pelos webhooks. */
@Entity({ name: 'subscriptions' })
@Index('UQ_subscriptions_provider_ref', ['provider', 'providerSubscriptionId'], { unique: true })
export class Subscription {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_subscriptions_id' })
  id: string;

  @Index('IDX_subscriptions_userId')
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_subscriptions_userId' })
  user?: User;

  @Column({ type: 'varchar', length: 40 })
  planId: string;

  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ type: 'varchar', length: 255 })
  providerSubscriptionId: string;

  @Column({ type: 'varchar', length: 20 })
  status: SubscriptionStatus;

  /** A pessoa cancelou, mas o período pago continua valendo até `currentPeriodEnd`. */
  @Column({ type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ type: Date, nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ type: Date, nullable: true })
  canceledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
