# Começar um projeto novo a partir desta base

Checklist para transformar a base no **seu** projeto. Faça na ordem; cada item diz onde mexer.

> Os comandos `npm` e os caminhos deste guia (`package.json`, `.env`, `serverless.yml`, `src/...`) são **da API**,
> em `apps/api/`. O front fica em `apps/web/` (veja [WEB.md](WEB.md)).

## 1. Copiar e dar nome

1. Copie a pasta (ou use "Use this template" no GitHub) e rode `npm install` em `apps/api` e em `apps/web`.
2. Troque o nome em três lugares:

   | Onde | O quê |
   | --- | --- |
   | `package.json` → `name` | nome do pacote (ex.: `minha-api`; o do front em `apps/web/package.json`) |
   | `serverless.yml` → `service` | prefixo de **tudo** na AWS: funções, filas, bucket, parâmetros do SSM (`/minha-api/<stage>/...`) |
   | `APP_NAME` (no `.env` da API e, em produção, a variável `APP_NAME` do environment do GitHub) | nome do produto: e-mails, Swagger, app autenticador do 2FA **e** o front (título da aba, login, barra lateral). Localmente o front lê `VITE_APP_NAME` do `apps/web/.env` |

3. Ajuste o título/descrição do Swagger em `buildOpenApiDocument` ([src/app.setup.ts](../apps/api/src/app.setup.ts)).

## 2. Configurar o ambiente local

```bash
cp .env.example .env
```

Todas as variáveis estão comentadas no [.env.example](../apps/api/.env.example). Para desenvolver, o padrão já funciona com o `docker compose up -d`.

## 3. Gerar segredos (para cada ambiente de servidor)

Nunca reaproveite os valores de exemplo: em produção a API **se recusa a subir** com eles.

```bash
openssl rand -base64 48
```

Rode duas vezes: um valor para `JWT_SECRET`, outro (diferente) para `ENCRYPTION_KEY`. Na AWS eles vão no SSM
(veja [DEPLOY_AWS_LAMBDA.md](DEPLOY_AWS_LAMBDA.md#3-segredos-no-ssm-parameter-store)).

> `ENCRYPTION_KEY` cifra os segredos de 2FA no banco: **não troque depois** de ter usuários com 2FA.

## 4. Telas que o front precisa ter

A API manda e-mails com links para o **front** (`FRONTEND_URL`). Crie estas rotas no seu front (ou ajuste os
caminhos no código — busque por `frontendUrl`):

| Rota do front | Quando é aberta | O que a tela faz |
| --- | --- | --- |
| `/verify-email?token=...` | link de confirmação do cadastro **e** da troca de e-mail | `POST /api/v1/auth/email/verify { token }` |
| `/reset-password?token=...` | link do "esqueci minha senha" | pede a nova senha e chama `POST /api/v1/auth/password/reset` |
| `/login` | botão do e-mail de boas-vindas | login |
| `/forgot-password` | botão do e-mail "sua senha foi alterada" | `POST /api/v1/auth/password/forgot` |
| `/account/security` | botões dos alertas de segurança | sessões (`/users/me/sessions`), 2FA, formas de login |

Para gerar os tipos e as chamadas da API no front, veja [API_CLIENT.md](API_CLIENT.md).

## 5. Remover o que você não vai usar

Tudo é opcional e desacoplado. Exemplos:

| Não vai usar... | Faça |
| --- | --- |
| Login com Apple/Google | Deixe `APPLE_CLIENT_IDS` / `GOOGLE_CLIENT_IDS` vazios (o provedor fica desligado). Para remover o código: `src/auth/social/` e as referências no `auth.module.ts` |
| Fila de e-mails (SQS) | `MAIL_DELIVERY=sync` e remova `mailWorker`, `MailQueue` e `MailDeadLetterQueue` do `serverless.yml` |
| Uploads | Remova `FilesModule` do `app.module.ts`, o avatar em `users`, e o bucket do `serverless.yml` |
| Tipo de arquivo de exemplo `document` | Apague a linha em [src/files/file-purposes.ts](../apps/api/src/files/file-purposes.ts) |
| Role `manager` | Remova de `role.enum.ts` e de `ROLE_PERMISSIONS` ([permission.enum.ts](../apps/api/src/common/enums/permission.enum.ts)) |
| Confirmação de e-mail obrigatória | `REQUIRE_EMAIL_VERIFICATION=false` |

Depois de remover algo, rode `npm run typecheck && npm test` para achar o que ficou pendurado.

## 6. Criar as suas funcionalidades

Siga as [receitas](GUIDES.md). A mais comum é "criar um módulo novo (CRUD)". Regras de ouro:

- **Toda rota exige login por padrão.** Use `@Public()` só no que for de fato aberto.
- **Proteja por permissão**, não por role: `@Authorize(Permission.ORDERS_READ)`.
- **Todo dado de entrada passa por um DTO** com `class-validator`. Campos não declarados são recusados.
- **Erros com chave de tradução:** `throw new NotFoundException(i18nKey('orders.notFound'))`.
- **Mudou uma entidade? Gere a migration.** O teste `npm run test:pg` falha se você esquecer.
- **Mudou rota/DTO? Rode `npm run openapi:export`** e commite o `openapi.json`. O CI confere.

## 7. Antes de ir para produção

Siga o [passo a passo do primeiro deploy](FIRST_DEPLOY.md) e o [checklist de produção](SECURITY.md#checklist-de-produção).
