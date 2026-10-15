import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Contador de requisições por chave (ex.: rota + IP, rota + e-mail) numa janela de tempo.
 * Fica no banco para ser compartilhado entre todas as instâncias (containers da Lambda).
 */
@Entity({ name: 'rate_limits' })
export class RateLimit {
  @PrimaryColumn({ type: 'varchar', length: 255, primaryKeyConstraintName: 'PK_rate_limits_key' })
  key: string;

  @Column({ type: 'int' })
  hits: number;

  /** Fim da janela atual, em epoch ms. */
  @Column({ type: 'bigint' })
  expiresAt: string;
}
