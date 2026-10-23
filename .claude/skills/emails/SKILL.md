---
name: emails
description: Como os e-mails da API deste repositório funcionam e como criar ou mudar um — modelos Handlebars em português e inglês, assuntos traduzidos, MailService, envio direto ou por fila SQS, pré-visualização com npm run mail:preview e os testes que conferem os modelos. Use ao criar, editar ou depurar qualquer e-mail.
---

# E-mails

Código em `apps/api/src/mail/`. Receita curta também em `docs/GUIDES.md` ("Novo e-mail").

## Peças

| Onde | O quê |
| --- | --- |
| `mail.types.ts` | `enum MailTemplate` (nome do arquivo) e `MailTemplateContextMap` (variáveis de cada modelo, tipadas) |
| `templates/<idioma>/<modelo>.hbs` | O corpo, um por idioma (`en`, `pt-BR`) |
| `templates/layouts/main.hbs`, `templates/partials/button.hbs`, `templates/<idioma>/partials/footer.hbs` | Moldura, botão (`{{> button url=x label="..."}}`), rodapé |
| `src/i18n/locales/{en,pt-BR}.json` → `mail.subjects` | Assuntos (`{appName}` disponível) |
| `mail.service.ts` | `send()` genérico + um helper por e-mail (`sendWelcome`, `sendPaymentConfirmed`...) |
| `scripts/mail-preview.ts` | Exemplos de cada modelo para a pré-visualização |

- Variáveis globais em todo modelo: `appName`, `appUrl`, `frontendUrl`, `supportEmail`, `subject`.
- Idioma: o salvo na conta (`user.locale`); sem ele, o da requisição; senão `FALLBACK_LANGUAGE`.
- Entrega: `MAIL_DELIVERY=sync` envia na hora; `sqs` põe na fila e o Lambda `mailWorker` envia.
  Transporte `MAIL_TRANSPORT` = `json` (dev/teste, não envia), `smtp` ou `ses`.
- `send()` nunca lança: devolve `false` e loga. Mesmo assim, quem chama de dentro de um fluxo importante
  (pagamento, webhook) envolve em try/catch (ver `notify()` em `payments.service.ts`).
- Datas/valores formatados no helper: `formatDate` (data e hora curta), `formatDay` (data por extenso),
  `formatMoney`, todos no fuso `MAIL_TIMEZONE`.

## Novo e-mail (passo a passo)

1. `mail.types.ts`: valor no enum + entrada no `MailTemplateContextMap`.
2. `templates/pt-BR/<modelo>.hbs` e `templates/en/<modelo>.hbs` (copie o estilo de `role-changed.hbs`:
   `<h1>`, "Olá, {{name}}.", tabela de detalhes, botão). `{{#if x}}...{{else}}...{{/if}}` para variações.
3. Assunto em `mail.subjects` nos dois JSON.
4. Helper `sendX(user, ...)` no `MailService` (resolve idioma, assunto, contexto).
5. `mail-template.service.spec.ts`: acrescente o contexto de exemplo em `contexts` (o teste exige um arquivo
   por modelo em cada idioma e renderiza todos sem variável sobrando).
6. `scripts/mail-preview.ts`: entrada em `SUBJECT_KEYS` e em `samples()` (senão o typecheck falha).
7. Chame o helper no service do fluxo e teste no e2e com `jest.spyOn(app.get(MailService), 'sendX')`.

## Ver os e-mails

```bash
cd apps/api && npm run mail:preview
```
Gera `apps/api/tmp/mail-preview/<idioma>/<modelo>.html` (não envia nada). Abra no navegador.

## E-mails que existem

Conta: welcome, verify-email, forgot-password, password-changed, role-changed, account-created, magic-link.
Segurança: new-login, two-factor-changed, social-linked, passkey-added, email-changed, account-deleted.
Plano: payment-confirmed, payment-refunded, subscription-canceled, courtesy-given, courtesy-ending
(regras de quando cada um sai: skill `payments`).
