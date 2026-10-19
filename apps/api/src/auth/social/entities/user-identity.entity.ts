import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../../users/entities/user.entity';

/**
 * Vínculo entre um usuário e uma conta de login social (Google, Apple...).
 * Um usuário pode ter vários; cada conta do provedor (provider + subject) só vincula a um usuário.
 */
@Entity({ name: 'user_identities' })
@Index('UQ_user_identities_provider_subject', ['provider', 'providerUserId'], { unique: true })
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_user_identities_id' })
  id: string;

  @Index('IDX_user_identities_userId')
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_user_identities_userId' })
  user?: User;

  /** google | apple */
  @Column({ type: 'varchar', length: 20 })
  provider: string;

  /** O "sub" do ID token: id estável do usuário no provedor (o e-mail pode mudar, o sub não). */
  @Column({ type: 'varchar', length: 255 })
  providerUserId: string;

  /** E-mail informado pelo provedor no momento do vínculo (informativo). */
  @Column({ type: 'varchar', length: 180, nullable: true })
  email: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
