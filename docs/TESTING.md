# Testes e CI

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
- O ambiente dos e2e está em [test/setup-env.ts](../test/setup-env.ts). Lá ficam limites de rate limit altos e bcrypt rápido (custo 4).

## Cobertura

```bash
npm run test:cov
```

Roda unitários **e** e2e juntos e mede a cobertura **combinada** ([jest.coverage.js](../jest.coverage.js)). O relatório HTML
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

A cada push na `main` e em todo Pull Request, o [ci.yml](../.github/workflows/ci.yml) roda numa máquina limpa:

1. `npm ci`
2. **`npm audit`**: falha com vulnerabilidade alta ou crítica em dependência de produção
3. Lint (ESLint + Prettier) e checagem de tipos
4. Unitários + e2e com cobertura (o relatório fica para download e o resumo aparece na página da execução)
5. Migrations + e2e no Postgres
6. Build
7. **Contrato:** `openapi.json` precisa estar atualizado (veja [API_CLIENT.md](API_CLIENT.md))

Para **bloquear merge** de PR com ❌: *Settings → Branches → Branch protection rules → Require status checks → "Lint, testes e build"*.

O [Dependabot](../.github/dependabot.yml) abre PRs semanais de atualização (npm), e mensais para GitHub Actions e a imagem
Docker. Cada PR passa pelo CI antes do merge.

O deploy ([deploy.yml](../.github/workflows/deploy.yml)) é **manual** (*Actions → Deploy → Run workflow*). Veja
[DEPLOY_AWS_LAMBDA.md](DEPLOY_AWS_LAMBDA.md#9-deploy-pelo-github-actions).

### Rodar exatamente o que o CI roda

```bash
npm audit --omit=dev --audit-level=high && npm run lint && npm run typecheck && npm run test:cov && npm run test:pg && npm run build && npm run openapi:export
```
