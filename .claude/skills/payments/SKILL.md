---
name: payments
description: Arquitetura dos pagamentos deste repositório — Stripe, InfinitePay e AbacatePay atrás de uma interface só, planos editáveis no admin, checkout, webhooks, assinatura, cancelamento, reembolso, Pro vitalício, Pro de cortesia (grants) e o painel de plano do usuário no admin. Use para qualquer mudança ou dúvida sobre cobrança, planos, /billing, webhooks ou configuração das plataformas.
---

# Pagamentos

Código em `apps/api/src/payments/`; guia do usuário (setup de cada plataforma, eventos de webhook, variáveis)
em `docs/PAYMENTS.md`. Front: `apps/web/src/pages/account/BillingPage.tsx` (pessoa),
`pages/admin/PlansPage.tsx` e `pages/admin/UserBillingSection.tsx` (admin).

## Regra de ouro

Nada vira "pago" pela palavra do navegador: só por **webhook verificado** ou **consulta à plataforma**, e com o
valor conferido (pagou menos que `payment.amount` → fica `pending` e loga). Aplicar o mesmo evento duas vezes não
muda nada (idempotente). O navegador manda só `{ planId, provider? }`; o preço sai do banco.

## Peças

| Arquivo | Papel |
| --- | --- |
| `providers/payment-provider.ts` | A interface `PaymentProvider` e os eventos normalizados (`PaymentEvent`) |
| `providers/{stripe,infinitepay,abacatepay}.provider.ts` | Uma por plataforma |
| `payment-providers.ts` | Liga as de `PAYMENT_PROVIDERS` (ordem = preferência); sem as chaves, fica de fora com aviso "ficou desligado" |
| `payments.service.ts` | Checkout, confirmação, `billing()`, `apply()` dos eventos, ações de admin, e-mails |
| `plans.service.ts` + `entities/plan.entity.ts` | Tabela `plans` (semeada com `DEFAULT_PLANS` de `plans.ts` se vazia) |
| `grants.service.ts` + `grants.module.ts` + `entities/grant.entity.ts` | Pro de cortesia (`plan_grants`); módulo próprio para o job de manutenção usar |
| `payments.controller.ts` | Rotas públicas/da pessoa + webhooks |
| `admin-plans.controller.ts` | `/admin/plans` (`plans:manage`) |
| `admin-billing.controller.ts` | `/users/:id/billing`, cancelar, reembolsar, grant (`billing:manage`); registrado DEPOIS do PaymentsController |

Tabelas: `plans`, `payments` (compra única ou a 1ª cobrança da assinatura; renovações **não** viram linha),
`subscriptions` (espelho da plataforma), `plan_grants`.

## Interface de uma plataforma

```ts
id; supports: { one_time, subscription }; methods; cancelModes: ('period_end' | 'now')[]
createCheckout(input)        // input.products: ProductStore (quem cobra por produto guarda o id criado)
handleWebhook(request)       // confere assinatura/segredo/consulta; lança 400 ou devolve eventos
confirm(payment, params)     // na volta do checkout (/billing/return), pergunta à plataforma
cancelSubscription?(sub, mode)
refund?(payment, reason)     // compra única, valor inteiro
cancelAndRefund?(sub)        // cancela agora e devolve a última cobrança
```
Eventos: `payment.paid {paymentId, amount?, providerRef?}`, `payment.refunded {paymentId}`,
`subscription.updated {providerSubscriptionId, status, cancelAtPeriodEnd?, currentPeriodEnd?, paymentId?}`.
Plataforma nova: implementar, registrar em `payment-providers.ts`, id em `PROVIDER_IDS`, testes em
`providers/providers.spec.ts` + `test/payments.e2e-spec.ts`. Os botões do admin aparecem sozinhos conforme os
métodos opcionais existirem.

## O que cada plataforma faz

| | Stripe | InfinitePay | AbacatePay |
| --- | --- | --- | --- |
| Único / assinatura | sim / sim | sim / **não** | sim / sim |
| Produto | `price_data` na hora | não precisa | a API cria `POST /v2/products/create` por preço; id em `plan.providerProducts` (chave = hash da API key + ciclo + preço) |
| Confirmação | webhook `Stripe-Signature` + releitura | `payment_check` (webhook não assinado; `?token=` HMAC do paymentId) | `?webhookSecret=` + `X-Webhook-Signature` (HMAC base64 com a chave pública) |
| Cancelar | `period_end` ou `now` | — | só `now` |
| Reembolso API | único + última fatura (`invoices.retrieve` expand `payments`) | **não** (admin registra: `refund: 'manual'`) | só único (`/v2/checkouts/refund`); assinatura não |
| Teste | `sk_test_`, cartão 4242… | **não tem** | Dev mode |

- Stripe API 2026: período em `items.data[].current_period_end`; fatura → `parent.subscription_details.subscription`.
  `charge.refunded` acha a compra pelo `metadata.paymentId` do intent ou, na assinatura, pela 1ª fatura
  (`billing_reason === 'subscription_create'`) via `invoicePayments.list`.
- AbacatePay: formato do corpo do webhook não documentado; `paymentIdOf`/`subscriptionIdOf` procuram em vários
  lugares. Ajuste lá se o log mostrar evento sem id.
- Eventos de webhook a marcar em cada painel: lista em `docs/PAYMENTS.md` ("Passo a passo por plataforma").

## Regras de negócio

- **É Pro** (`state()` em payments.service): compra única paga (vitalício) OU assinatura não cancelada OU grant
  ativo. `billing()` devolve `{ plan, lifetime, grant, subscription, payments }` (pendentes só < 24 h).
- **Vitalício** bloqueia qualquer outra compra (`payments.alreadyLifetime`); a tela mostra "Já incluído". Quem
  assinava e comprou o vitalício vê aviso para cancelar (a API não cancela sozinha).
- **Planos:** preço novo vale só para compras novas; tipo e ciclo não mudam; plano não se apaga (`active: false`).
  Mínimo 50 centavos (Stripe).
- **Cancelamento pela pessoa:** primeiro de `cancelModes` (Stripe: fim do período). **Admin** escolhe entre
  `cancelOptions` (`period_end`, `now`, `now_refund`, conforme a plataforma).
- **Reembolso** só de compra única paga (`refundKind`: `api` | `manual` | null). Perde o que a compra deu.
- **Grant (cortesia):** meses (1–24) ou `endsAt`; dar de novo estende a partir do fim; revogar encerra; termina
  sozinho pela data (sem webhook/cron). Bloqueado para vitalício e assinatura ativa (`grantHasSubscription`).
- **E-mails** (via `notify()`, nunca derruba o fluxo): pagamento confirmado, assinatura cancelada (ao pedir com
  data; "terminou agora" só se acabar antes do previsto), reembolso, cortesia dada/estendida, cortesia acabando
  (job de manutenção, 3 dias antes, uma vez: `endingNoticeAt`). Pendente e renovação não mandam nada.
- Auditoria: `payment.paid|refunded`, `subscription.started|canceled`, `plan.created|updated`,
  `billing.subscription_canceled|payment_refunded|grant_given|grant_revoked` (as do admin com `actorId` do admin).

## Configuração

`PAYMENT_PROVIDERS`, `INFINITEPAY_HANDLE` (variáveis do GitHub); `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET` (SSM `/nestjs-base-api/prod/`, SecureString, lidos **no deploy**).
Checar o que está ligado em produção: `curl -s https://api.base.dyonisio.dev/api/v1/payments/plans`.

## Testes

- `providers/providers.spec.ts`: casos de borda de cada plataforma (fetch falso, `jest.spyOn(provider.client...)`).
- `test/payments.e2e-spec.ts`: fluxos completos com as três ligadas; helpers `buyer()`/`subscriber()` criam
  compra/assinatura direto no banco; e-mails checados com `jest.spyOn(mail, 'sendX')`.
- Front: `BillingPage.test.tsx`, `PlansPage.test.tsx`, `UserBillingSection.test.tsx` (mocka `lib/external`, que
  faz o redirect para o checkout).
