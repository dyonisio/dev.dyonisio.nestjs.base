import type { Plan } from './entities/plan.entity';

export type { Plan, PlanInterval, PlanKind } from './entities/plan.entity';

/**
 * Os planos de EXEMPLO com que a tabela `plans` nasce (só quando está vazia). Depois disso quem
 * manda é o admin, em /admin/plans: preço, nomes, ordem e o que está à venda.
 */
export const DEFAULT_PLANS: readonly Pick<
  Plan,
  | 'id'
  | 'kind'
  | 'interval'
  | 'amount'
  | 'currency'
  | 'nameEn'
  | 'namePt'
  | 'descriptionEn'
  | 'descriptionPt'
  | 'sortOrder'
>[] = [
  {
    id: 'pro-lifetime',
    kind: 'one_time',
    interval: null,
    amount: 9900,
    currency: 'BRL',
    nameEn: 'Pro, lifetime',
    namePt: 'Pro vitalício',
    descriptionEn: 'Pay once, keep Pro forever.',
    descriptionPt: 'Paga uma vez e fica com o Pro para sempre.',
    sortOrder: 0,
  },
  {
    id: 'pro-monthly',
    kind: 'subscription',
    interval: 'month',
    amount: 2990,
    currency: 'BRL',
    nameEn: 'Pro, monthly',
    namePt: 'Pro mensal',
    descriptionEn: 'Billed every month. Cancel any time.',
    descriptionPt: 'Cobrado todo mês. Cancele quando quiser.',
    sortOrder: 1,
  },
];

/** O nome e a descrição no idioma da pessoa. */
export const planText = (plan: Plan, lang: string) =>
  lang === 'pt-BR'
    ? { name: plan.namePt, description: plan.descriptionPt }
    : { name: plan.nameEn, description: plan.descriptionEn };
