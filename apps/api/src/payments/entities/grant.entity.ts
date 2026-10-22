import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Pro de cortesia dado pelo admin, até uma data. Não passa por plataforma nenhuma: vale enquanto
 * `endsAt` não chega (sem webhook nem tarefa agendada) e o admin não revoga.
 */
@Entity({ name: 'plan_grants' })
export class Grant {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_plan_grants_id' })
  id: string;

  @Index('IDX_plan_grants_userId')
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_plan_grants_userId' })
  user?: User;

  @Column({ type: Date })
  endsAt: Date;

  /** Por que foi dado (só o admin vê). */
  @Column({ type: 'varchar', length: 200 })
  reason: string;

  /** Quem deu. Sem FK: o registro fica mesmo se esse admin sair. */
  @Column({ type: 'uuid', nullable: true })
  grantedById: string | null;

  @Column({ type: Date, nullable: true })
  revokedAt: Date | null;

  /** Quando saiu o e-mail "termina em breve" (uma vez só; estender zera). */
  @Column({ type: Date, nullable: true })
  endingNoticeAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
