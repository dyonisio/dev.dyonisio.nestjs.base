# Testes e CI

> Os comandos deste guia são da API e rodam em `apps/api`. Os testes do front estão no fim ([Front](#front-appsweb)).

## Os três tipos de teste

| Comando | O que roda | Banco |
| --- | --- | --- |
| `npm test` | **Unitários** (`src/**/*.spec.ts`): regras isoladas, ramos difíceis de provocar por HTTP (corridas, falhas, limites) | mocks ou sql.js em memória |
| `npm run test:e2e` | **E2E** (`test/*.e2e-spec.ts`): sobe a aplicação inteira e faz requisições HTTP de verdade | SQLite em memória (sql.js) |
| `npm run test:pg` | Migrations + **a suíte e2e inteira** num **Postgres de verdade** | [PGlite](https://pglite.dev), Postgres dentro do Node, sem Docker |

Nenhum deles precisa de Docker, internet, AWS ou e-mail real: e-mails usam o transporte `json`, uploads usam o disco
(`tmp/test-uploads`), e o login social usa um "Google de mentira" com chaves geradas no teste (`test/social/fake-oidc.ts`).

### O que o `test:pg` garante

1. Aplica todas as migrations num banco vazio.
2. Compara o schema resultante com as entidades: **tem que dar zero diferenças**. Mudou uma entidade e esqueceu a migration? Falha.
3. Desfaz todas (`down`) e aplica de novo.
4. Testa migrations de dados e o SQL do rate limiting, inclusive com concorrência.
5. Roda todos os e2e no Postgres, com as tabelas criadas pelas migrations, como em produção.

### Escrevendo testes

- **Rota nova → teste e2e** cobrindo pelo menos: caminho feliz, 401 sem login, 403 sem permissão, 400 de validação e 404 de recurso de outro usuário.
- **Regra de segurança → teste que tenta o ataque** (veja `test/social-login.e2e-spec.ts`, "pré-sequestro", ou `test/files.e2e-spec.ts`, "public/../").
- Para verificar e-mails, espione o `MailService`: `jest.spyOn(app.get(MailService), 'sendWelcome')`.
- O ambiente dos e2e está em [test/setup-env.ts](../apps/api/test/setup-env.ts). Lá ficam limites de rate limit altos e bcrypt rápido (custo 4).

## Cobertura

```bash
npm run test:cov
```

Roda unitários **e** e2e juntos e mede a cobertura **combinada** ([jest.coverage.js](../apps/api/jest.coverage.js)). O relatório HTML
fica em `coverage/lcov-report/index.html`.

**Entra na conta** só código com lógica. Ficam de fora DTOs, entidades, `*.module.ts`, enums, migrations e os pontos de
entrada (`main.ts`, `lambda.ts`, handlers).

**Metas** (o comando e o CI falham abaixo delas):

| Escopo | Linhas | Branches | Funções |
| --- | --- | --- | --- |
| Projeto inteiro | 95% | 88% | 95% |
| Pastas de segurança: `auth/*`, `common/guards`, `common/crypto`, `common/validators`, `rate-limit`, `sessions`, `users/account` | 95% | 90% | 95% |

- Não é "80% por arquivo": arquivos declarativos geram ramos sem lógica, e meta por arquivo incentiva teste que só executa sem verificar nada.
  A régua alta fica onde um bug vira falha de segurança.
- As metas são uma **catraca**: ficam um pouco abaixo do valor atual para a cobertura nunca cair.
- Cobertura mede o que **executou**, não o que foi **verificado**. Revise se os testes conferem algo útil.

## CI (GitHub Actions)

A cada push na `main` e em todo Pull Request, o [ci.yml](../.github/workflows/ci.yml) roda **dois jobs em paralelo**,
`API` e `Web`, cada um numa máquina limpa. O job da API:

1. `npm ci`
2. **`npm audit`**: falha com vulnerabilidade alta ou crítica em dependência de produção
3. Lint (ESLint + Prettier) e checagem de tipos
4. Unitários + e2e com cobertura (o relatório fica para download e o resumo aparece na página da execução)
5. Migrations + e2e no Postgres
6. Build
7. **Contrato:** `openapi.json` precisa estar atualizado (veja [API_CLIENT.md](API_CLIENT.md))

O job do front: `npm ci`, `npm audit`, **tipos da API atualizados** (regenera o `schema.d.ts` a partir do `openapi.json`
commitado e falha se mudou), Prettier, TypeScript, testes e build.

Para **bloquear merge** de PR com ❌: *Settings → Branches → Branch protection rules → Require status checks* → marque
"API: lint, testes e build" e "Web: lint, testes e build".

O [Dependabot](../.github/dependabot.yml) abre PRs de atualização: semanais para o npm da API e do front (patch/minor, agrupados), mensais para
as GitHub Actions e a imagem Docker. Cada PR passa pelo CI antes do merge. Versões **major** (que quebram API) não viram PR
automático: atualize-as quando planejar, lendo o changelog. Vulnerabilidades continuam sendo pegas pelo `npm audit` do CI e
pelos alertas de segurança do GitHub.

O deploy ([deploy.yml](../.github/workflows/deploy.yml)) é **manual** (*Actions → Deploy → Run workflow*). Veja
[DEPLOY_AWS_LAMBDA.md](DEPLOY_AWS_LAMBDA.md#9-deploy-pelo-github-actions).

### Rodar exatamente o que o CI roda

```bash
npm audit --omit=dev --audit-level=high && npm run lint && npm run typecheck && npm run test:cov && npm run test:pg && npm run build && npm run openapi:export
```

## Front (`apps/web`)

Testes com **Vitest + Testing Library** num navegador simulado (jsdom). Ficam ao lado do código (`*.test.ts(x)`).
A API **não** é chamada: o `fetch` é trocado por um roteador falso ([fetch-mock.ts](../apps/web/src/test/fetch-mock.ts)).

```ts
mockFetch({
  'POST /api/v1/auth/login': () => json(200, { twoFactorRequired: true, twoFactorToken: 'x' }),
});
```

Para testar uma tela inteira já logado, use `renderApp` ([render.tsx](../apps/web/src/test/render.tsx)):

```ts
const fetch = renderApp('/account/privacy', makeUser({ role: 'admin' }), {
  'DELETE /api/v1/users/me': () => new Response(null, { status: 204 }),
});
expect(await lastBody(fetch, 'DELETE', '/api/v1/users/me')).toEqual({ currentPassword: 'x' });
```

O que já está coberto: o cliente da API (token em toda chamada, renovação só no 401 de token vencido, **um único**
refresh para várias chamadas simultâneas, sessão encerrada se o refresh falhar), login com e sem 2FA, menu e telas de
admin conforme as permissões, ativação do 2FA, exclusão da conta e criação de usuário por convite.

Rodar o que o CI roda (em `apps/web`):

```bash
npm run api:types && npm run lint && npm run typecheck && npm test && npm run build
```
