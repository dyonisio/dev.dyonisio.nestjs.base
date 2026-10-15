import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuditAction, type AuditTargetType } from './audit-action.enum';

/**
 * Trilha de auditoria: quem fez o quê, em quem, quando e de onde.
 * Sem FK para users de propósito — o registro precisa sobreviver ao usuário.
 */
@Entity({ name: 'audit_logs' })
@Index('IDX_audit_logs_actor', ['actorId', 'createdAt'])
@Index('IDX_audit_logs_target', ['targetType', 'targetId', 'createdAt'])
@Index('IDX_audit_logs_createdAt', ['createdAt'])
export class AuditLog {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_audit_logs_id' })
  id: string;

  @ApiProperty({ enum: AuditAction, example: AuditAction.USER_ROLE_CHANGED })
  @Column({ type: 'varchar', length: 60 })
  action: AuditAction;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Who performed the action (null = anonymous, e.g. failed login)',
  })
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @ApiPropertyOptional({ example: 'user', nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  targetType: AuditTargetType | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: { from: 'user', to: 'manager' },
    description: 'Action details (never passwords or tokens)',
  })
  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Same id as the X-Request-Id header / logs' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  requestId: string | null;

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;
}
