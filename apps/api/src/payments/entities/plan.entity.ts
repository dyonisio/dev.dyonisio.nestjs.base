import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type PlanKind = 'one_time' | 'subscription';
export type PlanInterval = 'month' | 'year';

/**
 * Um plano à venda, editado pelo admin (/admin/plans). Valores em centavos.
 *
 * Mudar o preço vale para as próximas compras: o que já foi pago fica com o valor da época
 * (payment.amount), e uma assinatura já ativa segue com o preço que tinha na plataforma.
 */
@Entity({ name: 'plans' })
export class Plan {
  /** Identificador estável (vai nas compras e assinaturas): ex. `pro-monthly`. */
  @PrimaryColumn({ type: 'varchar', length: 40, primaryKeyConstraintName: 'PK_plans_id' })
  id: string;

  @Column({ type: 'varchar', length: 20 })
  kind: PlanKind;

  /** Só nas assinaturas. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  interval: PlanInterval | null;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 3, default: 'BRL' })
  currency: string;

  @Column({ type: 'varchar', length: 80 })
  nameEn: string;

  @Column({ type: 'varchar', length: 80 })
  namePt: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  descriptionEn: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  descriptionPt: string;

  /** Fora de venda: some da tela /billing, mas quem já comprou continua com ele. */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Ordem na tela (menor primeiro). */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  /**
   * Produtos que a API criou nas plataformas que cobram por produto (AbacatePay), um por
   * preço: `{ abacatepay: { "<chave>": "prod_..." } }`. Mudou o preço, nasce outro.
   */
  @Column({ type: 'simple-json', nullable: true })
  providerProducts: Record<string, Record<string, string>> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
