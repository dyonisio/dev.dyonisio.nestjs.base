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

/** bigint do Postgres chega como string: o contador de assinaturas volta a ser número. */
const bigintAsNumber = {
  to: (value: number) => value,
  from: (value: string | number) => Number(value),
};

/**
 * Passkey (WebAuthn): a chave pública de um par cuja chave privada fica no aparelho da pessoa
 * (celular, computador, chave física) ou no gerenciador de senhas dela. A API nunca vê a privada.
 */
@Entity({ name: 'passkeys' })
@Index('UQ_passkeys_credentialId', ['credentialId'], { unique: true })
export class Passkey {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_passkeys_id' })
  id: string;

  @Index('IDX_passkeys_userId')
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_passkeys_userId' })
  user?: User;

  /** Id da credencial (base64url), escolhido pelo autenticador. É por ele que o login acha a passkey. */
  @Column({ type: 'varchar', length: 512 })
  credentialId: string;

  /** Chave pública no formato COSE, em base64url. */
  @Column({ type: 'text' })
  publicKey: string;

  /** Contador de assinaturas: se voltar para trás, a credencial pode ter sido clonada. */
  @Column({ type: 'bigint', default: 0, transformer: bigintAsNumber })
  counter: number;

  /** Como o navegador fala com o autenticador (internal, hybrid, usb...), separados por vírgula. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  transports: string | null;

  /** singleDevice (preso a um aparelho) | multiDevice (sincronizada: iCloud, Google...) */
  @Column({ type: 'varchar', length: 20 })
  deviceType: string;

  /** A passkey tem cópia (sincronizada na nuvem do gerenciador de senhas). */
  @Column({ type: 'boolean', default: false })
  backedUp: boolean;

  /** Nome que a pessoa vê na tela de segurança ("Chrome · Windows", "iPhone"...). */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: Date, nullable: true })
  lastUsedAt: Date | null;
}
