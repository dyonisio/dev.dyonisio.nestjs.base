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

export enum SessionRevokeReason {
  LOGOUT = 'logout',
  PASSWORD_CHANGED = 'password-changed',
  REUSE_DETECTED = 'reuse-detected',
  USER_DISABLED = 'user-disabled',
  USER_DELETED = 'user-deleted',
  /** Encerrada pelo próprio usuário em "meus dispositivos". */
  REVOKED_BY_USER = 'revoked-by-user',
  /** Encerrada por um admin (ex.: "acho que invadiram minha conta"). */
  REVOKED_BY_ADMIN = 'revoked-by-admin',
  /** Conta não confirmada assumida pelo dono real do e-mail (login social). */
  ACCOUNT_CLAIMED = 'account-claimed',
}

/**
 * Uma sessão = um login (dispositivo/navegador). O access token carrega o id dela (`sid`)
 * e o JwtStrategy recusa tokens de sessões revogadas — logout e troca de senha
 * derrubam inclusive os access tokens ainda não expirados.
 */
@Entity({ name: 'sessions' })
export class Session {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_sessions_id' })
  id: string;

  @Index('IDX_sessions_userId')
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_sessions_userId' })
  user?: User;

  /** Janela deslizante: renovada a cada refresh (REFRESH_TOKEN_EXPIRES_IN). */
  @Column({ type: Date })
  expiresAt: Date;

  @Column({ type: Date, nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  revokedReason: SessionRevokeReason | null;

  /** Navegador/app que abriu a sessão (para "meus dispositivos"). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  /** Último IP visto (atualizado a cada refresh). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  /** Último refresh (≈ última vez que o dispositivo usou a API). */
  @Column({ type: Date, nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
