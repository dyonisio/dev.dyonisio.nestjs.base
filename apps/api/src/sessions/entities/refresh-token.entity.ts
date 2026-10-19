import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Session } from './session.entity';

/**
 * Refresh token de uma sessão. O valor entregue ao cliente é "<id>.<segredo>";
 * no banco guardamos apenas o SHA-256 do segredo (vazar o banco não vaza sessões).
 *
 * Cada token só pode ser usado uma vez: o refresh marca `usedAt` e cria outro
 * na mesma sessão. Os usados ficam guardados para detectar reuso (token roubado).
 */
@Entity({ name: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_refresh_tokens_id' })
  id: string;

  @Index('IDX_refresh_tokens_sessionId')
  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId', foreignKeyConstraintName: 'FK_refresh_tokens_sessionId' })
  session?: Session;

  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: Date, nullable: true })
  usedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
