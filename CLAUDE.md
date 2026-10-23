# NestJS Base (API + front)

Monorepo: `apps/api` (NestJS 11 + TypeORM, Postgres) e `apps/web` (React + Vite + openapi-fetch).
Produção: front `https://base.dyonisio.dev` (S3 + CloudFront), API `https://api.base.dyonisio.dev`
(Lambda, us-east-2), DNS na Cloudflare.

## Antes de mexer, carregue a skill da área

| Área | Skill |
| --- | --- |
| Rota, módulo, entidade, migration, permissão, auditoria, testes da API | `api-feature` |
| Pagamentos, planos, assinatura, reembolso, cortesia, webhooks | `payments` |
| Telas, componentes, i18n do front, pré-visualização, testes do front | `web-app` |
| E-mails (modelos, assuntos, pré-visualização) | `emails` |
| Login, sessões, 2FA, passkeys, Google/Apple, reautenticação, minha conta | `auth-accounts` |
| Deploy, variáveis, SSM, GitHub Actions, domínios, job de manutenção | `deploy-ops` |

Detalhes longos ficam em `docs/` (a skill diz qual). Não releia a conversa antiga: o estado está no código e nelas.

## Regras do projeto

- **Idioma:** converse em pt-BR. Comentários e logs em português; Swagger (descrições das rotas) em inglês.
- **Nunca suba Docker** na máquina do usuário. Nunca peça nem repita segredos (tokens, senhas, chaves): diga onde colocar.
- **Sessões checadas no banco** a cada requisição. Não troque por JWT stateless sem pedido explícito.
- **Deploy:** Lambda hoje, mas o `Dockerfile` (ECS no futuro) tem que continuar funcionando.
- Esta máquina **não tem** `gh` nem credenciais da AWS: o deploy é manual (Actions → Deploy → Run workflow → `prod`)
  e quem roda é o usuário. Confira a produção com `curl` em rotas públicas.

## Antes de commitar (o que o CI roda)

API (`apps/api`):
```bash
npm run lint && npm run typecheck && npm run test:cov && npm run test:pg && npm run openapi:export
```
Front (`apps/web`), depois de exportar o openapi:
```bash
npm run api:types && npm run lint && npm run typecheck && npx vitest run && npm run build
```
- `npm run format` (prettier) nos dois antes do lint.
- Rodar só uma suíte e2e: `npx jest --config ./test/jest-e2e.json --runInBand <nome>`. Não rode o
  `jest.coverage.js` filtrado: ele sobe todas as suítes em paralelo e estoura a memória.
- O CI falha se o `apps/api/openapi.json` commitado estiver desatualizado.

## Commit

- Mensagem em português, título curto + corpo explicando o porquê; termina com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push: `git push origin main:master` (o branch local é `main`, o remoto é `master`).
- Push não faz deploy. Avise o usuário quando a mudança precisar de deploy (código novo, migration, SSM novo).
