import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/entities/user.entity';

export type FileStatus = 'pending' | 'ready';

/**
 * Registro de um arquivo enviado. O conteúdo fica no storage (S3 ou disco);
 * aqui fica quem enviou, para quê, onde está e se o upload foi concluído/validado.
 */
@Entity({ name: 'files' })
@Index('IDX_files_status_createdAt', ['status', 'createdAt']) // busca da limpeza automática
export class StoredFile {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_files_id' })
  id: string;

  @Index('IDX_files_ownerId')
  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId', foreignKeyConstraintName: 'FK_files_ownerId' })
  owner?: User;

  @ApiProperty({ example: 'avatar' })
  @Column({ type: 'varchar', length: 30 })
  purpose: string;

  /** Caminho no storage: public|private/<finalidade>/<dono>/<uuid>.<ext> */
  @Index('UQ_files_key', { unique: true })
  @Column({ type: 'varchar', length: 512 })
  key: string;

  @ApiProperty({ example: 'image/png' })
  @Column({ type: 'varchar', length: 100 })
  contentType: string;

  @ApiProperty({
    example: 48213,
    description: 'Size in bytes (declared; the real one after completion)',
  })
  @Column({ type: 'int' })
  size: number;

  @ApiProperty({
    enum: ['pending', 'ready'],
    description: '`pending` until POST /files/:id/complete',
  })
  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: FileStatus;

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  @Column({ type: Date, nullable: true })
  completedAt: Date | null;

  /**
   * Quando o arquivo passou a ser usado por algo (ex.: virou o avatar) — via FilesService.consume().
   * Upload concluído que nunca é usado é lixo e sai na limpeza automática (FilesCleanupService).
   */
  @Column({ type: Date, nullable: true })
  attachedAt: Date | null;
}
