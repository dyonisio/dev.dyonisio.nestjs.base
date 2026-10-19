# NestJS Base

Base pronta para produção com **API em NestJS 11 + TypeORM (Postgres)** e **front em React**: autenticação
completa, permissões, e-mails, uploads, LGPD, segurança endurecida, testes e deploy na **AWS Lambda**
(ou em container no ECS).

Um repositório, dois apps independentes (cada um com o próprio `package.json`):

| Pasta | O que é |
| --- | --- |
| [`apps/api`](apps/api) | A API (NestJS). Todos os comandos `npm` da API rodam **dentro desta pasta** |
| [`apps/web`](apps/web) | O front (React + Vite), com o cliente tipado gerado do contrato da API. Veja [docs/WEB.md](docs/WEB.md) |
| [`docs`](docs) | Os guias. Caminhos como `src/...`, `.env` e `serverless.yml` nos guias são **da API** (`apps/api/...`) |

A ideia é começar um projeto novo já com tudo o que "toda API precisa" resolvido e testado, e gastar o tempo
só com as regras do seu negócio.

## O que já vem pronto

| Área | O que tem |
| --- | --- |
| **Autenticação** | Cadastro com confirmação de e-mail, login por senha, por **link mágico** (sem senha, 2FA mantido) ou por **passkey** (digital/rosto/PIN, à prova de phishing), JWT curto + refresh token com rotação e detecção de roubo, sessões revogáveis ("meus dispositivos"), esqueci/troca de senha |
| **Segundo fator** | 2FA por app autenticador (TOTP) com códigos de recuperação |
| **Login social** | Google e Apple, com proteção contra sequestro de conta |
| **Permissões** | Roles (`admin`, `manager`, `user`) como pacotes de **permissões** (`users:read`, `audit:read`...); tudo fechado por padrão |
| **Minha conta (LGPD)** | Troca de e-mail confirmada pelo novo endereço, exclusão da conta com anonimização após 30 dias, exportação dos dados |
| **Alertas de segurança** | E-mail ao dono em login de dispositivo novo, troca de senha/e-mail, 2FA ligado/desligado, Google/Apple vinculado |
| **Usuários (admin)** | CRUD com busca, ordenação e paginação; exclusão reversível; ver e encerrar as sessões de um usuário; trilha de auditoria |
| **Arquivos** | Upload genérico direto para o S3 (URL pré-assinada), validação do conteúdo real, avatar como primeiro uso, limpeza automática |
| **E-mails** | Templates separados por e-mail **e por idioma**, SMTP ou Amazon SES, envio síncrono ou por fila (SQS + DLQ) |
| **Idiomas** | Erros traduzidos pelo `Accept-Language` (`pt-BR`, `en`); e-mails no idioma do usuário |
| **Segurança** | Rate limiting no banco, segredos derivados por finalidade, validação estrita de entrada, configuração de produção validada no boot... ver [SECURITY.md](docs/SECURITY.md) |
| **Operação** | Logs JSON com `X-Request-Id`, job de manutenção agendado, alarmes no CloudWatch, health check |
| **Contrato da API** | Swagger em `/docs`, `openapi.json` versionado e rotas em `/api/v1` |
| **Qualidade** | ~500 testes (unitários + e2e em SQLite **e** num Postgres real), cobertura mínima garantida, CI no GitHub Actions, Dependabot |
| **Front** | React com todas as telas: login (senha, Google/Apple, 2FA), cadastro, senha e convite, minha conta (foto, e-mail, senha), segurança (2FA com QR code, dispositivos, formas de login), privacidade (exportar/excluir) e admin (usuários e auditoria, conforme as permissões). Cliente tipado gerado do `openapi.json` |
| **Deploy** | Um só deploy publica a API e o front (S3 + CloudFront, CSP e HTTPS), com domínios próprios opcionais. AWS Lambda (Serverless Framework) ou container (Dockerfile para ECS/Fargate) |

## Começando (5 minutos)

Requisitos: **Node.js 22** e **Docker** (só para o Postgres e o Mailpit locais).

### API

```bash
cd apps/api
```

```bash
npm install
```

```bash
cp .env.example .env
```

Suba o Postgres e o Mailpit (servidor de e-mail falso, com caixa de entrada em http://localhost:8025):

```bash
docker compose up -d
```

Crie as tabelas e o administrador inicial (o seed mostra a senha gerada no terminal):

```bash
npm run migration:run
```

```bash
npm run seed
```

```bash
npm run start:dev
```

| O quê | Onde |
| --- | --- |
| API | http://localhost:3000/api/v1 |
| Swagger (teste as rotas pelo navegador) | http://localhost:3000/docs — faça login, clique em **Authorize** e cole o `accessToken` |
| E-mails enviados | http://localhost:8025 |
| Health check | http://localhost:3000/api/health |

> Sem Docker? Os testes não precisam dele (usam bancos em memória). Para rodar a API, aponte `DB_*` para qualquer Postgres.

### Front

Em outro terminal, com a API rodando:

```bash
cd apps/web
```

```bash
npm install
```

```bash
npm run dev
```

Abra http://localhost:5173 e entre com o administrador do seed. O front fala com `http://localhost:3000`
por padrão (mude em `apps/web/.env` → `VITE_API_URL`; veja o `.env.example`).

## Começar um projeto novo

Para usar esta base num produto novo, troque nome, identificador, domínios, repositório e cor de uma vez:

```bash
node scripts/new-project.mjs
```

Ele pergunta cada valor (ou receba tudo por parâmetro: `--name "Acme Portal" --domain portal.acme.com
--repo acme/portal --color "#2563eb" --yes`; `--dry-run` só mostra o que mudaria). Troca o nome do produto
(API, e-mails, 2FA, front), o identificador (serviço e recursos na AWS, pacotes, políticas IAM), os domínios dos
exemplos e da documentação, o repositório da trust policy e a cor da marca (com as variações do tema escuro). A
identidade atual fica em `project.json`, então dá para rodar de novo. No fim ele lista o que é manual: o logo
(`apps/web/public/icon.png` e `favicon.svg`), o `git remote` e as variáveis no GitHub. O `.env` local não é tocado.

## Documentação

| Guia | Para quê |
| --- | --- |
| [Começar um projeto novo](docs/GETTING_STARTED.md) | Checklist para transformar esta base no **seu** projeto (nomes, segredos, o que remover) |
| [Arquitetura](docs/ARCHITECTURE.md) | Como uma requisição percorre a API, os módulos, as convenções e a autorização |
| [Autenticação e conta](docs/AUTH.md) | Sessões, refresh, e-mail, senha, 2FA, login social, "minha conta", alertas |
| [Funcionalidades](docs/FEATURES.md) | Usuários, auditoria, arquivos, e-mails, idiomas, rate limiting, manutenção, logs |
| [Receitas](docs/GUIDES.md) | Passo a passo: novo módulo, nova permissão, migration, e-mail, tipo de upload, tarefa agendada, idioma |
| [Segurança](docs/SECURITY.md) | O que está protegido e como, checklist de produção e decisões conscientes |
| [Front (apps/web)](docs/WEB.md) | Como o front está organizado, sessão e refresh, idiomas, telas e como adicionar uma |
| [Cliente para o front](docs/API_CLIENT.md) | Gerar tipos e chamadas do front a partir do `openapi.json` |
| [Testes e CI](docs/TESTING.md) | Tipos de teste, cobertura, CI e como rodar tudo localmente |
| [Primeiro deploy, passo a passo](docs/FIRST_DEPLOY.md) | Banco, segredos, e-mail (SES), GitHub ↔ AWS e o deploy — para quem nunca publicou na AWS, com os erros comuns |
| [Deploy do front e domínios](docs/DEPLOY_WEB.md) | Front no S3 + CloudFront, domínios próprios para o site e a API (exemplo com Cloudflare) |
| [Deploy na AWS (referência)](docs/DEPLOY_AWS_LAMBDA.md) | Detalhes técnicos da Lambda, operação, alarmes e a alternativa em container (ECS) |

## Scripts

### API (em `apps/api`)

| Script | O que faz |
| --- | --- |
| `npm run start:dev` | Servidor com hot reload |
| `npm run build` / `start:prod` | Compila para `dist/` / roda o build |
| `npm test` | Testes unitários |
| `npm run test:e2e` | Testes e2e (banco em memória, e-mails sem envio real) |
| `npm run test:pg` | Migrations + e2e num **Postgres real** (PGlite, sem Docker) |
| `npm run test:cov` | Unitários + e2e com cobertura combinada e metas mínimas |
| `npm run lint` / `format` / `typecheck` | ESLint / Prettier / TypeScript |
| `npm run migration:generate -- src/database/migrations/Nome` | Gera uma migration a partir das entidades |
| `npm run migration:run` / `migration:revert` | Aplica / desfaz migrations (`migration:run:prod` usa o JS compilado, para containers) |
| `npm run seed` | Cria o administrador inicial |
| `npm run maintenance` | Roda o job de manutenção uma vez (`maintenance:prod` no container) |
| `npm run openapi:export` | Atualiza o `openapi.json` (contrato da API) |
| `npm run mail:preview` | Renderiza todos os e-mails, em todos os idiomas, em `tmp/mail-preview/` |
| `npm run lambda:invoke -- GET /api/health` | Invoca o handler da Lambda localmente (após `build`) |
| `npm run deploy` / `deploy:prod` | Deploy na AWS Lambda |

### Front (em `apps/web`)

| Script | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento em http://localhost:5173 |
| `npm run build` / `preview` | Gera o site estático em `dist/` / serve o build localmente |
| `npm test` | Testes (Vitest + Testing Library) |
| `npm run lint` / `format` / `typecheck` | Prettier / TypeScript |
| `npm run api:types` | Regenera `src/api/schema.d.ts` a partir do `apps/api/openapi.json` |

## Estrutura

```
apps/
├── api/                        # a API (todos os comandos dela rodam aqui)
│   ├── src/                    # código (detalhado abaixo)
│   ├── test/                   # testes e2e (+ postgres/: Postgres real)
│   ├── openapi.json            # contrato da API (gerado — não edite à mão)
│   ├── serverless.yml          # deploy na Lambda
│   └── Dockerfile              # deploy em container
└── web/                        # o front
    └── src/
        ├── api/                # cliente tipado (schema.d.ts gerado do openapi.json) e upload
        ├── auth/               # sessão, refresh, login e permissões
        ├── i18n/               # textos da interface (pt-BR, en)
        ├── components/         # layout, campos, modal, confirmação de identidade, login social
        └── pages/              # as telas (account/: minha conta; admin/: usuários e auditoria)
docs/                           # guias
.github/                        # CI (API e front) e deploy
```

Dentro de `apps/api/src/`:

```
src/
├── main.ts / lambda.ts     # entrada: servidor HTTP / AWS Lambda
├── app.setup.ts            # configuração comum (helmet, CORS, /api/v1, validação, Swagger)
├── app.module.ts           # módulos + guards globais (rate limit → JWT → e-mail → roles → permissões)
├── config/                 # variáveis de ambiente tipadas + validação (inclusive regras de produção)
├── database/               # TypeORM, migrations, seed, TLS do banco
├── common/                 # decorators, guards, filtro de erros, contexto da requisição, crypto, validadores
├── auth/                   # login, cadastro, senha, e-mail, 2FA (two-factor/), login social (social/)
├── sessions/               # sessões e refresh tokens, "meus dispositivos"
├── users/                  # usuários (admin e perfil) + account/ (minha conta: e-mail, exclusão, exportação)
├── files/                  # upload genérico (finalidades, drivers S3/local, limpeza)
├── mail/                   # serviço, templates por idioma, fila SQS e worker
├── audit/                  # trilha de auditoria
├── rate-limit/             # limites de requisição com contadores no banco
├── maintenance/            # job agendado de faxina/anonimização
├── i18n/                   # traduções e idioma da requisição
└── health/                 # GET /api/health
```

Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
