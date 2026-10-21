# Pagamentos (exemplo)

> Os comandos `npm` e os caminhos deste guia (`.env`, `serverless.yml`, `src/...`) são da API: rode-os em `apps/api`.

Um módulo de exemplo com **pagamento único** e **assinatura**, que funciona com três plataformas:
**Stripe**, **InfinitePay** e **AbacatePay**. Todas implementam a mesma interface
([payment-provider.ts](../apps/api/src/payments/providers/payment-provider.ts)), então ligar, desligar ou trocar uma
não mexe no resto do sistema.

## O que cada uma faz

| | Stripe | InfinitePay | AbacatePay |
| --- | --- | --- | --- |
| Pagamento único | sim (cartão) | sim (Pix, cartão em até 12x) | sim (Pix, cartão) |
| Assinatura | sim | **não** (a API pública não tem recorrência) | sim |
| Ambiente de testes | sim (chaves `sk_test_`, cartões de teste) | **não**: toda cobrança é real | sim (Dev mode) |
| Precisa cadastrar o produto antes | não (o valor vai na cobrança) | não | **sim** (cada plano é um produto lá) |
| Como a API confirma o pagamento | webhook assinado + leitura na Stripe | consulta `payment_check` (o webhook não é assinado) | webhook com secret na URL + assinatura HMAC; consulta na volta |
| Cancelar assinatura | no fim do período já pago | — | na hora |

**Regra de ouro:** nada vira "pago" pela palavra do navegador. Só pelo que a plataforma confirma, e com o valor
conferido. Pagou menos do que o plano custa (produto errado, valor adulterado)? A compra fica pendente e o log avisa.

## Como funciona

```
/billing ─ "Comprar" ─▶ POST /payments/checkout ─▶ página da plataforma (Pix/cartão)
                                                         │
             webhook da plataforma ─▶ API confere ───────┤
                                                         ▼
   /billing/return?payment=… ─▶ POST /payments/:id/confirm (pergunta à plataforma) ─▶ "Pagamento confirmado"
```

- **Webhook e volta:** os dois caminhos confirmam. O webhook pode atrasar, e a volta pode não acontecer (a pessoa
  fecha a aba). Aplicar a mesma confirmação duas vezes não muda nada.
- **Pix:** pode levar alguns segundos. A tela de volta consulta de novo a cada 3 segundos, por cerca de um minuto.
- **Mais de uma plataforma:** se mais de uma atende o plano, a pessoa escolhe na tela. Com uma só, o checkout vai
  direto para ela.

## Rotas

| Rota | O que faz |
| --- | --- |
| `GET /payments/plans` | Público. Planos à venda, cada um com as plataformas que conseguem cobrá-lo |
| `POST /payments/checkout { planId, provider? }` | Logado com e-mail confirmado. Cria a cobrança e devolve a `url` da plataforma |
| `POST /payments/:id/confirm { params? }` | Na volta: consulta a plataforma. `params` = o que ela pôs na URL de volta |
| `GET /users/me/billing` | Plano atual (`free`/`pro`), assinatura e histórico |
| `POST /users/me/subscriptions/:id/cancel` | Cancela a assinatura na plataforma |
| `POST /payments/webhooks/:provider` | Avisos das plataformas (`stripe`, `infinitepay`, `abacatepay`) |

Tabelas: `payments` (cada compra ou primeira cobrança de assinatura) e `subscriptions` (o espelho da assinatura na
plataforma). Auditoria: `payment.paid`, `payment.refunded`, `subscription.started`, `subscription.canceled`.

## Os planos

Ficam em [plans.ts](../apps/api/src/payments/plans.ts): `pro-lifetime` (R$ 99, uma vez) e `pro-monthly`
(R$ 29,90/mês). São exemplos: troque pelos do seu produto. O "é Pro?" está em `PaymentsService.billing()`.

## Ligar

A variável `PAYMENT_PROVIDERS` diz quais plataformas ficam ligadas, na ordem de preferência: por exemplo
`stripe,abacatepay`. Vazia, os pagamentos ficam desligados e a tela mostra "não estão ligados". Uma plataforma
ligada sem as chaves dela fica de fora, com um aviso no log.

Em produção, as **chaves secretas** vão no SSM Parameter Store (como o `JWT_SECRET`), em
`/nestjs-base-api/prod/<NOME>`, do tipo *SecureString*. O que não é segredo vai em variáveis do GitHub.

| Nome | Onde (produção) | O que é |
| --- | --- | --- |
| `PAYMENT_PROVIDERS` | variável do GitHub | ex.: `stripe,infinitepay,abacatepay` |
| `STRIPE_SECRET_KEY` | SSM | chave secreta (`sk_live_...` ou `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | SSM | segredo do webhook (`whsec_...`) |
| `INFINITEPAY_HANDLE` | variável do GitHub | sua InfiniteTag, sem o `$` |
| `ABACATEPAY_API_KEY` | SSM | chave de API (a de Dev mode para testes) |
| `ABACATEPAY_WEBHOOK_SECRET` | SSM | o secret que você cadastrou no webhook |
| `ABACATEPAY_PRODUCTS` | variável do GitHub | `pro-lifetime:prod_xxx,pro-monthly:prod_yyy` |

O endereço público da API (usado na URL de webhook da InfinitePay) vem do `API_DOMAIN` no deploy.

## Passo a passo por plataforma

### Stripe

1. No painel da Stripe, em modo **teste**, copie a **chave secreta** (`sk_test_...`).
2. Em **Developers → Webhooks → Add endpoint**:
   - URL: `https://api.base.dyonisio.dev/api/v1/payments/webhooks/stripe`
   - Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
     `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`.
   - Copie o **Signing secret** (`whsec_...`).
3. Ponha as duas chaves no SSM e `stripe` em `PAYMENT_PROVIDERS`. Rode o Deploy.
4. Teste com o cartão `4242 4242 4242 4242`, qualquer validade futura e qualquer CVC.

Localmente, a [Stripe CLI](https://docs.stripe.com/stripe-cli) encaminha os webhooks para a sua máquina:
`stripe listen --forward-to localhost:3000/api/v1/payments/webhooks/stripe`. Ela mostra o `whsec_` que você põe no
`.env`.

### InfinitePay

1. Ponha sua **InfiniteTag** em `INFINITEPAY_HANDLE` e `infinitepay` em `PAYMENT_PROVIDERS`. Não há chave de API.
2. A URL do webhook vai sozinha em cada cobrança, com um código que só a API sabe gerar. A API ainda confirma cada
   aviso consultando o `payment_check` da InfinitePay.
3. **Não há ambiente de testes:** teste com um valor baixo (mude o preço do plano temporariamente) e estorne pelo app.
4. Só pagamento único: ela não aparece para o plano de assinatura.

### AbacatePay

1. Em modo **Dev**, crie uma **chave de API** e cadastre dois produtos: um único (R$ 99) e um com **ciclo mensal**
   (R$ 29,90), com o mesmo valor dos planos.
2. Ponha os ids dos produtos em `ABACATEPAY_PRODUCTS` (`pro-lifetime:prod_...,pro-monthly:prod_...`).
3. Crie o webhook apontando para `https://api.base.dyonisio.dev/api/v1/payments/webhooks/abacatepay?webhookSecret=SEU_SECRET`,
   com os eventos `checkout.completed`, `checkout.refunded`, `subscription.completed`, `subscription.renewed` e
   `subscription.cancelled`. O mesmo secret vai em `ABACATEPAY_WEBHOOK_SECRET`.
4. Ponha a chave no SSM e `abacatepay` em `PAYMENT_PROVIDERS`. No Dev mode, simule o pagamento pelo painel.

A documentação da AbacatePay não mostra o formato exato do corpo de cada evento. A API procura o id da compra e o da
assinatura nos lugares prováveis e registra no log quando não acha. Confira o primeiro evento real no log e, se
preciso, ajuste `paymentIdOf`/`subscriptionIdOf` em
[abacatepay.provider.ts](../apps/api/src/payments/providers/abacatepay.provider.ts).

## Acrescentar outra plataforma

1. Crie `src/payments/providers/<nome>.provider.ts` implementando `PaymentProvider`: `createCheckout`,
   `handleWebhook` (confere a autenticidade e devolve os eventos), `confirm` e, se tiver assinatura,
   `cancelSubscription`.
2. Registre em [payment-providers.ts](../apps/api/src/payments/payment-providers.ts) e acrescente o id em
   `PROVIDER_IDS`.
3. Cubra com testes como os de [providers.spec.ts](../apps/api/src/payments/providers/providers.spec.ts) e
   [payments.e2e-spec.ts](../apps/api/test/payments.e2e-spec.ts).

## Dados pessoais

As compras entram no "baixar meus dados" (sem os ids das plataformas) e a Política de Privacidade cita as
plataformas. O número do cartão e os dados do Pix nunca passam pela API: a pessoa os digita na página da plataforma.
