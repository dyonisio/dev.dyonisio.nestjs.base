/**
 * Catálogo de EXEMPLO do que se vende. Num produto de verdade, troque estes planos (ou leia de
 * uma tabela). Valores em centavos.
 *
 * Cada plataforma recebe o plano de um jeito:
 *  - Stripe e InfinitePay: o valor e o nome vão direto na cobrança (nada a cadastrar antes);
 *  - AbacatePay: cobra por produtos cadastrados nela. Crie um produto para cada plano (o de
 *    assinatura com ciclo) e informe os ids em ABACATEPAY_PRODUCTS (veja docs/PAYMENTS.md).
 */
export type PlanKind = 'one_time' | 'subscription';

export interface Plan {
  id: string;
  kind: PlanKind;
  /** Só para assinaturas. */
  interval?: 'month' | 'year';
  amount: number;
  currency: 'BRL';
  name: { en: string; 'pt-BR': string };
  description: { en: string; 'pt-BR': string };
}

export const PLANS: readonly Plan[] = [
  {
    id: 'pro-lifetime',
    kind: 'one_time',
    amount: 9900,
    currency: 'BRL',
    name: { en: 'Pro, lifetime', 'pt-BR': 'Pro vitalício' },
    description: {
      en: 'Pay once, keep Pro forever.',
      'pt-BR': 'Paga uma vez e fica com o Pro para sempre.',
    },
  },
  {
    id: 'pro-monthly',
    kind: 'subscription',
    interval: 'month',
    amount: 2990,
    currency: 'BRL',
    name: { en: 'Pro, monthly', 'pt-BR': 'Pro mensal' },
    description: {
      en: 'Billed every month. Cancel any time.',
      'pt-BR': 'Cobrado todo mês. Cancele quando quiser.',
    },
  },
];

export const findPlan = (id: string): Plan | undefined => PLANS.find((p) => p.id === id);
