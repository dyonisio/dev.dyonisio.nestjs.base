---
name: deploy-ops
description: Como este repositório vai para produção e como operar — deploy manual pelo GitHub Actions (API na AWS Lambda com Serverless, front no S3 + CloudFront), variáveis do GitHub, segredos no SSM, migrations no deploy, job de manutenção, domínios na Cloudflare, Dockerfile para ECS e como conferir a produção. Use ao acrescentar variável de ambiente, explicar configuração ao usuário ou investigar algo em produção.
---

# Deploy e operação

Guias longos: `docs/DEPLOY_AWS_LAMBDA.md` (API, SSM, SES, alarmes, ECS), `docs/DEPLOY_WEB.md` (front, domínios),
`docs/FIRST_DEPLOY.md`, `docs/SECURITY.md` (checklist de produção).

## Como sobe

- **Só manual:** GitHub → Actions → **Deploy** → Run workflow → stage `prod` (ou `dev`). Push no `master` **não**
  publica; o CI (`ci.yml`) só testa.
- O workflow (`.github/workflows/deploy.yml`, em `apps/api`): testes → login AWS por OIDC (`AWS_ROLE_ARN`) →
  `serverless deploy` com `--param=...` → **migrations pela Lambda `migrate`** (se falharem, a API não é
  atualizada) → infra e build do front → publica no S3 + invalida o CloudFront → resumo com DNS.
- Esta máquina não tem `gh` nem credenciais AWS: quem dispara é o usuário. Conferir produção com `curl` em rotas
  públicas, ex.: `curl -s https://api.base.dyonisio.dev/api/health` e `/api/v1/payments/plans`.
  Rota nova respondendo 404 (em vez de 401) = código novo ainda não subiu.

## Funções (`apps/api/serverless.yml`)

`api` (HTTP), `mailWorker` (fila SQS de e-mails), `migrate`, `maintenance` (a cada 6 h: anonimização, uploads,
sessões, auditoria, rate limits, aviso de cortesia acabando). Node 22, arm64.

## Variável nova (onde pôr)

| Tipo | Onde |
| --- | --- |
| Segredo | SSM SecureString `/nestjs-base-api/<stage>/NOME`; no `serverless.yml`: `NOME: ${ssm:/${self:service}/${sls:stage}/NOME, ''}` (o `, ''` deixa opcional) |
| Não secreta | Variável do environment no GitHub (`vars.NOME`) → `env:` do passo "Build + deploy" no deploy.yml → `params+=(--param="nome=$NOME")` → `serverless.yml`: `NOME: ${param:nome, ''}` |
| Front | `VITE_*` no passo "Build do front" do deploy.yml |

Sempre também: `src/config/configuration.ts` (leitura tipada), `.env.example` (com comentário) e, se for exigida
em produção, `src/config/env.validation.ts`.

- **O SSM é lido no momento do deploy.** Criou/trocou um parâmetro → rodar o Deploy de novo.
- Variáveis do GitHub existentes: `AWS_ROLE_ARN`, `AWS_REGION`, `FRONTEND_URL` (tem que ser https em produção),
  `MAIL_FROM`, `SUPPORT_EMAIL`, `ALARM_EMAIL`, `API_DOMAIN` + `API_CERTIFICATE_ARN`, `WEB_DOMAIN` +
  `WEB_CERTIFICATE_ARN`, `CORS_ORIGIN`, `SWAGGER_ENABLED`, `FALLBACK_LANGUAGE`, `APP_NAME`, `LEGAL_OWNER`,
  `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`, `WEB_GOOGLE_CLIENT_ID`, `WEB_APPLE_CLIENT_ID`,
  `WEB_APPLE_REDIRECT_URI`, `PAYMENT_PROVIDERS`, `INFINITEPAY_HANDLE`.
- SSM existentes: `DB_HOST`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`.

## Ambientes locais

- `.env` da API e do front são locais (não commitar). Nada de Docker na máquina do usuário: os testes de Postgres
  usam PGlite (`npm run test:pg`).
- `npm run maintenance` roda o job localmente. `node scripts/new-project.mjs` troca nome/domínio/repo/cor para
  começar outro projeto a partir desta base (`project.json` guarda a identidade).

## ECS (futuro)

O `Dockerfile` e `src/main.ts` têm que continuar funcionando: tudo que é configurado na app vai em
`configureApp()` (`src/app.setup.ts`), usado pelo `main.ts` e pelo `lambda.ts` (ex.: `rawBody: true` nos dois).
