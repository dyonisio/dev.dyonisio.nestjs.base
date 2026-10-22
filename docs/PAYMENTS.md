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
| Cadastro de produto | não (o valor vai na cobrança) | não | a API cria sozinha, um por preço |
| Como a API confirma o pagamento | webhook assinado + leitura na Stripe | consulta `payment_check` (o webhook não é assinado) | webhook com secret na URL + assinatura HMAC; consulta na volta |
| Cancelar assinatura | no fim do período já pago, ou na hora | — | só na hora |
| Reembolso pela API | compra única e última cobrança da assinatura | **não** (pelo app; o admin registra aqui) | só compra única (assinatura, pelo painel) |

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

## E-mails

A pessoa recebe um e-mail nosso (no idioma da conta) quando:

| Quando | E-mail |
| --- | --- |
| A compra, ou a primeira cobrança da assinatura, é confirmada | Pagamento confirmado: plano e valor |
| Pede o cancelamento | Assinatura cancelada: continua Pro até a data |
| A assinatura termina **antes** do previsto (admin cortou, cartão recusado de vez) | Assinatura cancelada: terminou agora |
| Recebe um reembolso | Reembolso: valor, e que perdeu o que a compra dava |
| Ganha ou tem estendido o Pro de cortesia | Pro de cortesia até a data |
| Faltam 3 dias para a cortesia acabar | Aviso, uma vez só (pelo job de manutenção, a cada 6 h) |

Compra pendente não manda nada (quase sempre é alguém que desistiu do checkout), e as renovações também não: o
recibo de cada cobrança é da plataforma. Na Stripe, ligue em **Settings → Customer emails** (*Successful payments*
e *Refunds*); em modo teste ela não envia. Um e-mail que falha nunca desfaz o pagamento: vai para o log.

## Rotas

| Rota | O que faz |
| --- | --- |
| `GET /payments/plans` | Público. Planos à venda, cada um com as plataformas que conseguem cobrá-lo |
| `POST /payments/checkout { planId, provider? }` | Logado com e-mail confirmado. Cria a cobrança e devolve a `url` da plataforma |
| `POST /payments/:id/confirm { params? }` | Na volta: consulta a plataforma. `params` = o que ela pôs na URL de volta |
| `GET /users/me/billing` | Plano atual (`free`/`pro`), assinatura e histórico |
| `GET /admin/plans`, `POST /admin/plans`, `PATCH /admin/plans/:id` | Admin (`plans:manage`): lista, cria e edita os planos |
| `POST /users/me/subscriptions/:id/cancel` | Cancela a assinatura na plataforma |
| `GET /users/:id/billing` | Admin (`billing:manage`): o plano de um usuário, com o que dá para fazer em cada item |
| `POST /users/:id/subscriptions/:subscriptionId/cancel { mode }` | Admin: `period_end`, `now` ou `now_refund` |
| `POST /users/:id/payments/:paymentId/refund { reason? }` | Admin: reembolsa uma compra única |
| `POST /users/:id/grant { months \| endsAt, reason }`, `DELETE /users/:id/grant` | Admin: Pro de cortesia |
| `POST /payments/webhooks/:provider` | Avisos das plataformas (`stripe`, `infinitepay`, `abacatepay`) |

Tabelas: `plans` (o que está à venda), `payments` (cada compra ou primeira cobrança de assinatura),
`subscriptions` (o espelho da assinatura na plataforma) e `plan_grants` (Pro de cortesia). Auditoria:
`payment.paid`, `payment.refunded`, `subscription.started`, `subscription.canceled`, `plan.created`,
`plan.updated` e, do admin, `billing.subscription_canceled`, `billing.payment_refunded`, `billing.grant_given`,
`billing.grant_revoked`.

## O admin e o plano de cada usuário

Em **Administração → Usuários → (a pessoa)**, a seção **Plano** (permissão `billing:manage`, que o admin tem):

- **Cancelar a assinatura**, escolhendo o jeito (só aparece o que a plataforma faz):
  - *no fim do período pago*: fica Pro até a data e nada mais é cobrado (Stripe);
  - *agora, sem reembolso* (Stripe e AbacatePay);
  - *agora, devolvendo a última cobrança* (Stripe). A AbacatePay não reembolsa assinatura pela API: devolva pelo
    painel dela.
- **Reembolsar uma compra única**: pela API na Stripe e na AbacatePay (sempre o valor inteiro). Na InfinitePay,
  que não tem API de reembolso, devolva pelo app e clique em *Registrar reembolso*: aqui só fica anotado. Nos dois
  casos a pessoa perde o que a compra deu (o vitalício, por exemplo).
- **Pro de cortesia**: 1, 2, 3, 6 ou 12 meses, com um motivo (só o admin vê). Não passa por plataforma nenhuma e
  **termina sozinho na data**: o "é Pro?" só olha se a data ainda não chegou, sem webhook nem tarefa agendada. Dar
  de novo estende a partir do fim da atual; dá para encerrar antes. Não vale para quem tem o vitalício ou paga
  assinatura (por ora).

O que o admin faz aqui a API faz na plataforma e grava na hora, com a resposta dela. O webhook que chega depois diz
a mesma coisa e não muda nada. O webhook continua sendo o caminho do que acontece **lá**: renovação, cartão
recusado, cancelamento ou **reembolso feito direto no painel** da plataforma.

## Os planos

Ficam na tabela `plans` e se editam na tela **Administração → Planos** (`/admin/plans`, permissão `plans:manage`,
que o admin tem): preço, nomes em português e inglês, descrição, ordem e se está à venda. Um banco novo nasce com
os dois de exemplo de [plans.ts](../apps/api/src/payments/plans.ts): `pro-lifetime` (R$ 99, uma vez) e
`pro-monthly` (R$ 29,90/mês).

- **Preço novo vale para as próximas compras.** O que já foi pago fica com o valor da época, e uma assinatura
  ativa segue com o preço que tinha na plataforma (para mudar o preço de quem já assina, só pelo painel dela).
- **Tipo e ciclo não mudam** depois de criado: compras e assinaturas antigas dependem deles. Crie outro plano.
- **Não se apaga plano**, só se tira de venda: some de `/billing`, e quem comprou continua com ele.
- O "é Pro?" está em `PaymentsService.billing()`: qualquer plano único pago, ou uma assinatura não cancelada.
- **Quem tem o vitalício não compra mais nada:** a tela mostra "Já incluído no seu Pro vitalício" e a API recusa
  (`payments.alreadyLifetime`). Quem já assinava e comprou o vitalício vê um aviso para cancelar a assinatura (a
  API não cancela sozinha: é cobrança na plataforma, a pessoa decide).

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

O endereço público da API (usado na URL de webhook da InfinitePay) vem do `API_DOMAIN` no deploy.

**O SSM é lido no deploy, não quando a API roda.** Criou ou trocou uma chave lá? Rode o Deploy de novo. Uma
plataforma ligada sem as chaves fica de fora (o log diz qual falta: procure "ficou desligado"), e a tela mostra só
as outras.

## Passo a passo por plataforma

### Stripe

1. No painel da Stripe, em modo **teste**, copie a **chave secreta** (`sk_test_...`).
2. Em **Developers → Webhooks → Add endpoint**:
   - URL: `https://api.base.dyonisio.dev/api/v1/payments/webhooks/stripe`
   - Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
     `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`.
   - O `charge.refunded` cobre o reembolso feito no painel da Stripe: a compra única vira "reembolsada", e a
     primeira cobrança de uma assinatura também (as renovações não viram compra aqui).
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
   A InfinitePay não avisa reembolsos: depois de estornar pelo app, registre em *Administração → Usuários → Plano*.
4. Só pagamento único: ela não aparece para o plano de assinatura.

### AbacatePay

1. Em modo **Dev**, crie uma **chave de API** (com permissão de criar produtos e cobranças). Não precisa cadastrar
   produtos: na primeira compra de cada preço a API cria o produto lá (com ciclo, se for assinatura) e guarda o id.
   Mudou o preço em `/admin/plans`, nasce outro produto; trocou a chave de Dev para produção, também.
2. Crie o webhook apontando para `https://api.base.dyonisio.dev/api/v1/payments/webhooks/abacatepay?webhookSecret=SEU_SECRET`,
   com os eventos `checkout.completed`, `checkout.refunded`, `subscription.completed`, `subscription.renewed` e
   `subscription.cancelled`. O mesmo secret vai em `ABACATEPAY_WEBHOOK_SECRET`. O `checkout.refunded` cobre o
   reembolso feito pelo painel dela. A chave de API precisa também da permissão de reembolso (`REFUND:CREATE`)
   para o botão *Reembolsar* do admin funcionar.
3. Ponha a chave no SSM e `abacatepay` em `PAYMENT_PROVIDERS`. No Dev mode, simule o pagamento pelo painel.

A documentação da AbacatePay não mostra o formato exato do corpo de cada evento. A API procura o id da compra e o da
assinatura nos lugares prováveis e registra no log quando não acha. Confira o primeiro evento real no log e, se
preciso, ajuste `paymentIdOf`/`subscriptionIdOf` em
[abacatepay.provider.ts](../apps/api/src/payments/providers/abacatepay.provider.ts).

## Acrescentar outra plataforma

1. Crie `src/payments/providers/<nome>.provider.ts` implementando `PaymentProvider`: `createCheckout`,
   `handleWebhook` (confere a autenticidade e devolve os eventos), `confirm` e, se tiver assinatura,
   `cancelModes` + `cancelSubscription`. Se ela reembolsa pela API, `refund` (e `cancelAndRefund`, para assinatura):
   o admin passa a ver os botões sozinho.
2. Registre em [payment-providers.ts](../apps/api/src/payments/payment-providers.ts) e acrescente o id em
   `PROVIDER_IDS`.
3. Cubra com testes como os de [providers.spec.ts](../apps/api/src/payments/providers/providers.spec.ts) e
   [payments.e2e-spec.ts](../apps/api/test/payments.e2e-spec.ts).

## Dados pessoais

As compras entram no "baixar meus dados" (sem os ids das plataformas) e a Política de Privacidade cita as
plataformas. O número do cartão e os dados do Pix nunca passam pela API: a pessoa os digita na página da plataforma.
