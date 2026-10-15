import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Permission, permissionsOf } from '../../common/enums/permission.enum';
import { Role } from '../../common/enums/role.enum';

/**
 * E-mail único só entre usuários NÃO excluídos (índice parcial): depois de um
 * soft delete, o mesmo e-mail pode ser cadastrado de novo.
 */
@Entity({ name: 'users' })
@Index('UQ_users_email_active', ['email'], { unique: true, where: '"deletedAt" IS NULL' })
export class User {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_users_id' })
  id: string;

  @ApiProperty({ example: 'Jane Doe' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ example: 'jane@example.com' })
  @Column({ type: 'varchar', length: 180 })
  email: string;

  /**
   * Novo e-mail pedido pelo usuário, aguardando a confirmação pelo link enviado a ele.
   * O e-mail da conta só muda depois de confirmado (POST /users/me/email).
   */
  @ApiProperty({ type: String, nullable: true, example: null })
  @Column({ type: 'varchar', length: 180, nullable: true })
  pendingEmail: string | null;

  /**
   * Hash bcrypt. Não é selecionado por padrão e nunca é serializado na resposta.
   * null = conta criada por login social que ainda não definiu senha.
   */
  @Exclude({ toPlainOnly: true })
  @Column({ type: 'varchar', length: 255, select: false, nullable: true })
  password?: string | null;

  @ApiProperty({ enum: Role, example: Role.USER })
  @Column({ type: 'varchar', length: 20, default: Role.USER })
  role: Role;

  /** Calculado a partir da role (não é coluna): o front usa para mostrar/esconder ações. */
  @ApiProperty({ enum: Permission, isArray: true, example: [] })
  @Expose()
  get permissions(): Permission[] {
    return permissionsOf(this.role);
  }

  @ApiProperty({ example: true })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'When the email was confirmed — `null` means not verified yet',
  })
  @Column({ type: Date, nullable: true })
  emailVerifiedAt: Date | null;

  @ApiProperty({
    nullable: true,
    example: 'pt-BR',
    description: 'Preferred language (emails are sent in it). null = default language',
  })
  @Column({ type: 'varchar', length: 10, nullable: true })
  locale: string | null;

  @ApiProperty({
    nullable: true,
    example: 'https://my-bucket.s3.us-east-1.amazonaws.com/public/avatar/<user>/<file>.png',
    description: 'Public avatar URL (set via PUT /users/me/avatar)',
  })
  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  /** Arquivo (tabela files) do avatar atual — apagado ao trocar/remover o avatar. */
  @Exclude({ toPlainOnly: true })
  @Column({ type: 'uuid', nullable: true })
  avatarFileId: string | null;

  // ---------- 2FA (TOTP) ----------

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'When two-factor authentication was enabled — `null` means disabled',
  })
  @Column({ type: Date, nullable: true })
  twoFactorEnabledAt: Date | null;

  /** Segredo TOTP cifrado (AES-256-GCM). Nunca selecionado por padrão nem serializado. */
  @Exclude({ toPlainOnly: true })
  @Column({ type: 'text', nullable: true, select: false })
  twoFactorSecret?: string | null;

  /** Última janela TOTP aceita — impede reutilizar o mesmo código. */
  @Exclude({ toPlainOnly: true })
  @Column({ type: 'int', nullable: true, select: false })
  twoFactorLastStep?: number | null;

  /** Hashes SHA-256 dos códigos de recuperação ainda não usados. */
  @Exclude({ toPlainOnly: true })
  @Column({ type: 'simple-json', nullable: true, select: false })
  twoFactorRecoveryCodes?: string[] | null;

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Soft delete: preenchido por DELETE /users/:id. O TypeORM esconde estes registros
   * de todas as consultas automaticamente (exceto com `withDeleted`).
   */
  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'When the user was deleted (soft delete) — only visible with `?deleted=true`',
  })
  @DeleteDateColumn({ type: Date, nullable: true })
  deletedAt: Date | null;

  /**
   * Quando os dados pessoais foram apagados (anonimização): a conta excluída há mais de
   * ACCOUNT_PURGE_AFTER_DAYS dias. Depois disso ela não pode mais ser restaurada.
   */
  @ApiProperty({ type: Date, nullable: true, description: 'When personal data was erased' })
  @Column({ type: Date, nullable: true })
  anonymizedAt: Date | null;
}
