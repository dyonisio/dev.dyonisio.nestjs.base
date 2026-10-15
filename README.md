# NestJS Base API

Base de API pronta para produção em **NestJS 11 + TypeORM (Postgres)**: autenticação completa, permissões,
e-mails, uploads, LGPD, segurança endurecida, testes e deploy na **AWS Lambda** (ou em container no ECS).

A ideia é começar um projeto novo já com tudo o que "toda API precisa" resolvido e testado, e gastar o tempo
só com as regras do seu negócio.

## O que já vem pronto

| Área | O que tem |
| --- | --- |
| **Autenticação** | Cadastro com confirmação de e-mail, login, JWT curto + refresh token com rotação e detecção de roubo, sessões revogáveis ("meus dispositivos"), esqueci/troca de senha |
| **Segundo fator** | 2FA por app autenticador (TOTP) com códigos de recuperação |
| **Login social** | Google e Apple, com proteção contra sequestro de conta |
| **Permissões** | Roles (`admin`, `manager`, `user`) como pacotes de **permissões** (`users:read`, `audit:read`...); tudo fechado por padrão |
| **Minha conta (LGPD)** | Troca de e-mail confirmada pelo novo endereço, exclusão da conta com anonimização após 30 dias, exportação dos dados |
| **Alertas de segurança** | E-mail ao dono em login de dispositivo novo, troca de senha/e-mail, 2FA ligado/desligado, Google/Apple vinculado |
| **Usuários (admin)** | CRUD com busca, ordenação e paginação; exclusão reversível; trilha de auditoria |
| **Arquivos** | Upload genérico direto para o S3 (URL pré-assinada), validação do conteúdo real, avatar como primeiro uso, limpeza automática |
| **E-mails** | Templates separados por e-mail **e por idioma**, SMTP ou Amazon SES, envio síncrono ou por fila (SQS + DLQ) |
| **Idiomas** | Erros traduzidos pelo `Accept-Language` (`pt-BR`, `en`); e-mails no idioma do usuário |
| **Segurança** | Rate limiting no banco, segredos derivados por finalidade, validação estrita de entrada, configuração de produção validada no boot... ver [SECURITY.md](docs/SECURITY.md) |
| **Operação** | Logs JSON com `X-Request-Id`, job de manutenção agendado, alarmes no CloudWatch, health check |
| **Contrato da API** | Swagger em `/docs`, `openapi.json` versionado e rotas em `/api/v1` |
| **Qualidade** | ~500 testes (unitários + e2e em SQLite **e** num Postgres real), cobertura mínima garantida, CI no GitHub Actions, Dependabot |
| **Deploy** | AWS Lambda (Serverless Framework) ou container (Dockerfile para ECS/Fargate) |

## Começando (5 minutos)

Requisitos: **Node.js 22** e **Docker** (só para o Postgres e o Mailpit locais).

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

## Documentação

| Guia | Para quê |
| --- | --- |
| [Começar um projeto novo](docs/GETTING_STARTED.md) | Checklist para transformar esta base no **seu** projeto (nomes, segredos, o que remover) |
| [Arquitetura](docs/ARCHITECTURE.md) | Como uma requisição percorre a API, os módulos, as convenções e a autorização |
| [Autenticação e conta](docs/AUTH.md) | Sessões, refresh, e-mail, senha, 2FA, login social, "minha conta", alertas |
| [Funcionalidades](docs/FEATURES.md) | Usuários, auditoria, arquivos, e-mails, idiomas, rate limiting, manutenção, logs |
| [Receitas](docs/GUIDES.md) | Passo a passo: novo módulo, nova permissão, migration, e-mail, tipo de upload, tarefa agendada, idioma |
| [Segurança](docs/SECURITY.md) | O que está protegido e como, checklist de produção e decisões conscientes |
| [Cliente para o front](docs/API_CLIENT.md) | Gerar tipos e chamadas do front a partir do `openapi.json` |
| [Testes e CI](docs/TESTING.md) | Tipos de teste, cobertura, CI e como rodar tudo localmente |
| [Deploy na AWS](docs/DEPLOY_AWS_LAMBDA.md) | Lambda passo a passo, alarmes, e a alternativa em container (ECS) |

## Scripts

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

## Estrutura

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
test/                       # testes e2e (+ postgres/: Postgres real)
docs/                       # guias
openapi.json                # contrato da API (gerado — não edite à mão)
```

Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
