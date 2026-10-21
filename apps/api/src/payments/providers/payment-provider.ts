import type { Payment } from '../entities/payment.entity';
import type { Subscription } from '../entities/subscription.entity';
import type { Plan, PlanKind } from '../entities/plan.entity';

export type ProviderId = 'stripe' | 'infinitepay' | 'abacatepay';
export const PROVIDER_IDS: readonly ProviderId[] = ['stripe', 'infinitepay', 'abacatepay'];

export type PaymentMethod = 'card' | 'pix' | 'boleto';

export interface CheckoutInput {
  payment: Payment;
  plan: Plan;
  /** O nome do plano no idioma da pessoa (aparece na página de pagamento). */
  title: string;
  customer: { name: string; email: string };
  /** Para onde a plataforma devolve a pessoa depois de pagar (a tela confirma o pagamento). */
  successUrl: string;
  /** Para onde a pessoa volta se desistir. */
  cancelUrl: string;
  /** Onde a plataforma avisa a API (webhook). */
  webhookUrl: string;
  /** Produtos que a API já criou nesta plataforma para este plano (quem cobra por produto). */
  products: ProductStore;
}

/**
 * Para plataformas que só cobram produtos cadastrados nelas (AbacatePay): a API cria o produto
 * na primeira compra de cada preço e guarda o id aqui (plan.providerProducts).
 */
export interface ProductStore {
  get(key: string): string | undefined;
  save(key: string, productId: string): Promise<void>;
}

export interface CheckoutResult {
  /** A página de pagamento da plataforma: o front manda a pessoa para lá. */
  url: string;
  /** O id da cobrança na plataforma, guardado em payment.providerRef. */
  providerRef: string;
}

/**
 * O que aconteceu, já traduzido para a língua da base. Só sai daqui depois de a plataforma
 * CONFIRMAR (assinatura do webhook conferida e/ou consulta à API dela): nunca a palavra do cliente.
 */
export type PaymentEvent =
  | { type: 'payment.paid'; paymentId: string; amount?: number; providerRef?: string }
  | { type: 'payment.refunded'; paymentId: string }
  | {
      type: 'subscription.updated';
      /** A compra que iniciou a assinatura (só no primeiro aviso; depois vale o id da assinatura). */
      paymentId?: string;
      providerSubscriptionId: string;
      status: Subscription['status'];
      cancelAtPeriodEnd?: boolean;
      currentPeriodEnd?: Date | null;
    };

export interface WebhookRequest {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

/**
 * Uma plataforma de pagamento. Para acrescentar outra (Mercado Pago, Pagar.me...): implemente
 * esta interface, registre em payment-providers.ts e acrescente o id em PROVIDER_IDS.
 */
export interface PaymentProvider {
  readonly id: ProviderId;
  /** O que ela sabe fazer: a tela só oferece o que funciona. */
  readonly supports: Record<PlanKind, boolean>;
  readonly methods: readonly PaymentMethod[];

  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;

  /**
   * Confere o aviso da plataforma (assinatura, segredo, consulta) e diz o que aconteceu.
   * Aviso falso ou desconhecido: lança (o controller responde 400) ou devolve [].
   */
  handleWebhook(request: WebhookRequest): Promise<PaymentEvent[]>;

  /**
   * Na volta do checkout, pergunta à plataforma como está a cobrança (o webhook pode atrasar).
   * `params`: o que a plataforma pôs na URL de volta (ex.: a InfinitePay manda o transaction_nsu).
   */
  confirm(payment: Payment, params: Record<string, string>): Promise<PaymentEvent[]>;

  /** Cancela a assinatura na plataforma (algumas mantêm até o fim do período pago). */
  cancelSubscription?(subscription: Subscription): Promise<PaymentEvent[]>;
}
