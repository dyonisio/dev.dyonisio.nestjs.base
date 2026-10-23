---
name: api-feature
description: Como criar ou mudar algo na API NestJS deste repositório (apps/api) — rota, módulo, DTO, entidade, migration, permissão, auditoria, erro traduzido, tarefa agendada e os testes (unit, e2e, Postgres, cobertura). Use antes de editar qualquer arquivo em apps/api/src ou apps/api/test.
---

# API: criar e mudar funcionalidades

Comandos em `apps/api`. Receitas completas em `docs/GUIDES.md`; pipeline e módulos em `docs/ARCHITECTURE.md`
(a tabela de módulos lá não lista `payments/`: veja a skill `payments`).

## Como uma rota fica protegida

Guards **globais** (rate limit → JWT + sessão no banco → e-mail confirmado → roles → permissões) e
`ValidationPipe` global com whitelist: **campo não declarado no DTO = 400**. Uma rota nova já nasce exigindo login.

```ts
@Public()                         // aberta
@Auth()                           // logado
@Authorize(Permission.X)          // logado + permissão (prefira isto a roles)
@AllowUnverified()                // libera e-mail não confirmado
@AuthRateLimit()                  // limite rígido (login, reset...)
@SkipThrottle()                   // webhooks
@CurrentUser('id') id
@Param('id', UuidParam) id        // 400 traduzido se não for UUID
```

- **Permissão nova:** `src/common/enums/permission.enum.ts` (`recurso:ação`). O admin recebe todas sozinho
  (`Object.values`). No front, acrescente à lista `ALL` em `src/preview/data.ts` **e** `src/test/render.tsx`.
- Permissões atuais: `users:read|create|update|delete|manage-roles|reset-2fa`, `audit:read`, `plans:manage`,
  `billing:manage`.
- **Ordem de controllers importa:** rotas `users/me/...` têm que ser registradas ANTES de `users/:id/...`, senão
  "me" vira `:id` (400 do UuidParam). Coloque o controller de admin depois no array `controllers` do módulo, ou em
  módulo registrado depois.

## DTOs, erros e traduções

- Validação com mensagem traduzível: decorators com parâmetro levam `{ message: i18nValidationMessage() }`
  (MaxLength, Min, Max, IsIn, IsEnum); os sem parâmetro (IsEmail, IsNotEmpty) não precisam. Chave própria:
  `i18nValidationMessage('validation.minhaChave')` + a chave em `validation` dos dois JSON.
- Nome amigável do campo nas mensagens: bloco `fields` em `src/i18n/locales/{en,pt-BR}.json`.
- Erros: `throw new NotFoundException(i18nKey('dominio.chave'))`. A chave tem que existir **nos dois** JSON
  (`en.json`, `pt-BR.json`): o TypeScript confere pelo `en`.
- Resposta de erro: `{ statusCode, code, message, errors?, requestId }`. O front decide pelo `code`.
- Swagger: `@ApiOperation({ summary, description })` em inglês, `@ApiOkResponse({ type })`, `@ApiErrors([400,
  '...'], [404, '...'])`. DTO de saída com `static from(entity)` que escolhe os campos (nunca devolva a entidade
  com segredos).

## Banco

- Entidade em `<modulo>/entities/*.entity.ts`, registrada com `TypeOrmModule.forFeature([...])` no módulo
  (`autoLoadEntities` pega o resto). Nomes de constraint explícitos: `PK_<tabela>_id`, `FK_<tabela>_<col>`,
  `IDX_...`, `UQ_...`.
- Tipos que funcionam em Postgres **e** no sql.js dos testes: `varchar(n)`, `int`, `boolean`, `uuid`,
  `type: Date` (timestamp), `simple-json` (vira `text`). Datas sempre UTC.
- **Migration à mão** em `src/database/migrations/<timestamp>-Nome.ts`, SQL de Postgres, com `down`. Timestamp
  maior que o último (o último é `1762200000000`). Nunca `synchronize` em produção.
- Tabela nova: acrescente o nome na lista em `test/postgres/migrations.pg-spec.ts` (ordem alfabética).
  O `npm run test:pg` aplica as migrations no PGlite e compara com as entidades.
- Dado inicial (seed) de tabela nova: dá para semear no `onModuleInit` do service quando a tabela está vazia,
  com `insert().orIgnore()` (ver `payments/plans.service.ts`).

## Auditoria

`await this.audit.record(AuditAction.X, { actorId, target: { type: 'user' | 'session' | 'plan', id }, metadata })`
(AuditService é global). Ação nova: `src/audit/audit-action.enum.ts` **e** tradução em `auditActions` nos dois
idiomas de `apps/web/src/i18n/messages.ts` (o typecheck do front falha sem). Nada de senha/token no `metadata`.

## Config e tarefa agendada

- Variáveis lidas só em `src/config/configuration.ts` (tipadas); validação de produção em `env.validation.ts`.
  Variável nova de deploy: `serverless.yml` + `.github/workflows/deploy.yml` + `.env.example` (skill `deploy-ops`).
- Tarefa periódica: uma linha em `tasks` de `src/maintenance/maintenance.service.ts` (roda a cada 6 h) e o
  módulo dela importado em `maintenance.module.ts`. Atualize `maintenance.service.spec.ts` (construtor e relatório).

## Testes

- **Unit** `src/**/*.spec.ts` (`npx jest <pasta>`); **e2e** `test/*.e2e-spec.ts`, app inteiro em sql.js
  (`npx jest --config ./test/jest-e2e.json --runInBand <nome>`); **Postgres** `npm run test:pg`.
- e2e: usuário com `app.get(UsersService).create({...}, { emailVerified: true })` e login em `/api/v1/auth/login`;
  admin com `role: Role.ADMIN`. Variáveis de ambiente específicas: `Object.assign(process.env, {...})` no topo e
  `import()` dos módulos dentro do `beforeAll`. Plataformas externas: `jest.spyOn` no client/`fetch`.
- **Cobertura combinada** (unit + e2e, `npm run test:cov`): global 95% linhas/funções, 88% branches; pastas críticas
  (auth, sessions, users/account...) 95/90. DTOs, entidades, módulos, enums e migrations ficam fora. Função nova sem
  teste derruba o limite: cubra cada callback (ex.: um `.map` que nunca roda no teste).
- Lint pega: `!` desnecessário, `require-await`, `no-base-to-string` (use `as string`), variável `_` não usada.

## Fechar a mudança

1. `npm run format && npm run lint && npm run typecheck && npm run test:cov && npm run test:pg`
2. Mudou rota/DTO: `npm run openapi:export` e, no front, `npm run api:types` (o CI confere o openapi).
3. Doc da área em `docs/` atualizada; commit e push conforme o `CLAUDE.md`.

## Pegadinha de edição

Heredoc de bash com acentos/aspas às vezes quebra no Windows ("unexpected EOF"). Para criar arquivo use Write;
para várias trocas use um script Python salvo no scratchpad (com `assert old in s` antes de cada `replace`).
