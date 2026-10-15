# Arquitetura

## Visão geral

```
                ┌──────────── src/main.ts (servidor HTTP: dev, Docker/ECS)
 requisição ──▶ │
                └──────────── src/lambda.ts (AWS Lambda + API Gateway)
                                   │
                         configureApp() — src/app.setup.ts (igual nos dois)
                                   │
                              AppModule
```

Os dois pontos de entrada usam **a mesma** `configureApp()`. A API se comporta igual em dev, nos testes e2e,
no container e na Lambda.

Além da API, existem duas aplicações "sem HTTP" que reaproveitam os mesmos módulos:

| Aplicação | Entrada | Para quê |
| --- | --- | --- |
| `mailWorker` | `src/mail/worker/mail-worker.handler.ts` | Lambda que consome a fila de e-mails (SQS) e envia |
| `maintenance` | `src/maintenance/maintenance.handler.ts` (ou `npm run maintenance`) | Job agendado: anonimização, faxina de uploads, sessões, auditoria e rate limits |

## O caminho de uma requisição

Na ordem em que acontece:

| # | Etapa | Onde | O que faz |
| --- | --- | --- | --- |
| 1 | Contexto da requisição | `common/request-context` | Gera/aceita o `X-Request-Id`, guarda IP, user agent e idioma (AsyncLocalStorage — acessível em qualquer lugar sem passar parâmetro) |
| 2 | Helmet | `app.setup.ts` | Headers de segurança |
| 3 | CORS | `app.setup.ts` | Só as origens de `CORS_ORIGIN` |
| 4 | Idioma | `i18n` | Resolve o `Accept-Language` |
| 5 | **Rate limit** | `rate-limit/app-throttler.guard.ts` | Geral por IP; rígido por IP e por e-mail nas rotas `@AuthRateLimit()` |
| 6 | **Autenticação** | `common/guards/jwt-auth.guard.ts` | Exige JWT válido (exceto `@Public()`), carrega sessão + usuário do banco |
| 7 | **E-mail confirmado** | `common/guards/email-verified.guard.ts` | Bloqueia quem não confirmou (exceto `@AllowUnverified()`) |
| 8 | **Roles** | `common/guards/roles.guard.ts` | Se a rota usa `@Auth(Role.X)` |
| 9 | **Permissões** | `common/guards/permissions.guard.ts` | Se a rota usa `@Authorize(Permission.X)` |
| 10 | Validação | `ValidationPipe` global | Converte e valida o corpo/query pelo DTO; **campos não declarados = 400** |
| 11 | Controller → Service | módulo da rota | A regra de negócio |
| 12 | Serialização | `ClassSerializerInterceptor` | Aplica `@Exclude()` (senha, segredos nunca saem) |
| 13 | Erros | `common/filters/i18n-exception.filter.ts` | Qualquer erro vira `{ statusCode, code, message, errors?, requestId }`, traduzido |

Os guards 5 a 9 são **globais** ([app.module.ts](../src/app.module.ts)). Uma rota nova já nasce protegida, mesmo
que você esqueça de colocar algum decorator.

## Módulos

| Módulo | Pasta | Responsabilidade | Exporta |
| --- | --- | --- | --- |
| `AuthModule` | `auth/` | Login, cadastro, senha, e-mail, 2FA (rotas), login social | — |
| `TwoFactorModule` | `auth/two-factor/` | Lógica do 2FA (TOTP, desafio, códigos) | `TwoFactorService`, `EncryptionService` |
| `SessionsModule` | `sessions/` | Sessões, refresh tokens, "meus dispositivos" | `SessionService`, `JwtModule` |
| `UsersModule` | `users/` | Usuários (admin + perfil) e "minha conta" (`account/`) | `UsersService`, `ReauthService`, ... |
| `FilesModule` | `files/` | Upload genérico, storage S3/local | `FilesService`, `FilesCleanupService` |
| `MailModule` | `mail/` | E-mails (templates, transporte, fila) | `MailService` |
| `AuditModule` (global) | `audit/` | Trilha de auditoria | `AuditService` |
| `RateLimitModule` | `rate-limit/` | Throttler global + contadores no banco | `DatabaseThrottlerStorage` |
| `MaintenanceModule` | `maintenance/` | Tarefas agendadas | `MaintenanceService` |
| `I18nModule` (global) | `i18n/` | Traduções | `I18nService` |
| `HealthModule` | `health/` | `GET /api/health` | — |

Dependências principais, sem ciclos:

```
AuthModule ──▶ UsersModule ──▶ TwoFactorModule ──▶ SessionsModule
     │             │  └──▶ FilesModule, MailModule, RateLimitStorage
     └─────────────┴──▶ SessionsModule, MailModule
MaintenanceModule ──▶ UsersModule, FilesModule, SessionsModule
```

## Autorização

### Decorators

```ts
@Public()                                  // rota aberta (sem login)
@Auth()                                    // qualquer usuário logado
@Authorize(Permission.USERS_READ)          // logado E com a permissão (preferido)
@Auth(Role.ADMIN)                          // logado E com a role (evite: prefira permissões)
@AllowUnverified()                         // libera quem ainda não confirmou o e-mail
@AuthRateLimit()                           // limite rígido de tentativas (rotas sensíveis)
@CurrentUser() user / @CurrentUser('id') id
```

### Roles e permissões

Uma **role** é só um pacote de **permissões**. As rotas checam a permissão, então criar uma role nova ou mudar o
que uma role pode fazer é editar **um mapa**, sem tocar em controllers:

```ts
// src/common/enums/permission.enum.ts
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),   // tudo
  [Role.MANAGER]: [Permission.USERS_READ],
  [Role.USER]: [],
};
```

| Permissão | Libera |
| --- | --- |
| `users:read` | `GET /users`, `GET /users/:id` |
| `users:create` | `POST /users` |
| `users:update` | `PATCH /users/:id` |
| `users:delete` | `DELETE /users/:id`, `PATCH /users/:id/restore` |
| `users:manage-roles` | `PATCH /users/:id/role` |
| `users:reset-2fa` | `DELETE /users/:id/two-factor` |
| `audit:read` | `GET /audit-logs` |

- `GET /users/me` devolve `permissions: [...]`: o front usa para mostrar ou esconder botões.
- A role é lida do banco **a cada requisição**. Trocar a role de alguém vale na hora, mesmo com tokens já emitidos.
- O que o próprio usuário faz consigo (perfil, senha, 2FA, sessões, minha conta) não precisa de permissão: basta estar logado.

### Mapa de acesso

| Rotas | Acesso |
| --- | --- |
| `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/register`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/email/verify`, `/auth/2fa/verify`, `/auth/social/:provider` | público (com rate limit) |
| `GET/PATCH /users/me`, `/users/me/email`, `DELETE /users/me`, `/users/me/export`, `/users/me/sessions`, `/users/me/identities`, `/auth/password/change`, `/auth/email/resend` | logado (mesmo sem e-mail confirmado) |
| `/auth/2fa/*`, `/files/*`, `/users/me/avatar` | logado com e-mail confirmado |
| `/users`, `/users/:id/*`, `/audit-logs` | permissões da tabela acima |

## Formato dos erros

Todo erro tem o mesmo formato, traduzido pelo `Accept-Language`:

```json
{
  "statusCode": 400,
  "code": "errors.validation",
  "message": "Erro de validação",
  "errors": [{ "field": "email", "code": "validation.isEmail", "message": "e-mail deve ser um e-mail válido" }],
  "requestId": "8f1c2a..."
}
```

- **O front deve usar `code`** (nunca muda). A `message` é só para exibir.
- `requestId` é o mesmo dos logs: o usuário informa ao suporte e você acha a requisição exata.
- Erro inesperado (500) nunca expõe stack trace ou detalhes internos na resposta; eles vão só para o log.

## Configuração

- Todas as variáveis são lidas em um único lugar, já tipadas: [src/config/configuration.ts](../src/config/configuration.ts).
  Use `config.get<number>('session.maxAgeDays')`, nunca `process.env` espalhado pelo código.
- [src/config/env.validation.ts](../src/config/env.validation.ts) valida no boot. Em **produção**, a API não sobe com
  configuração insegura (CORS aberto, segredos de exemplo, localhost, banco em memória...). Veja [SECURITY.md](SECURITY.md).

## Banco de dados

| Tabela | Conteúdo |
| --- | --- |
| `users` | Usuários (soft delete em `deletedAt`, anonimização em `anonymizedAt`, `pendingEmail` para troca de e-mail, 2FA cifrado) |
| `sessions` / `refresh_tokens` | Logins e tokens de renovação (só o hash) |
| `user_identities` | Vínculos com Google/Apple |
| `files` | Uploads (o conteúdo fica no S3/disco) |
| `audit_logs` | Trilha de auditoria |
| `rate_limits` | Contadores de limite de requisições |
| `migrations` | Controle do TypeORM |

- **Migrations sempre**, nunca `synchronize` (proibido em produção). O teste `npm run test:pg` compara as migrations com as
  entidades e falha se houver diferença.
- Em produção o certificado TLS do banco é conferido (`DB_SSL=true` + CA da AWS). Veja `certs/README.md`.

## Convenções de código

- Um módulo por domínio: `controller` (HTTP + Swagger), `service` (regra), `dto/` (entrada/saída), `entities/`.
- **Swagger em inglês** (contrato público); comentários e mensagens de log em português.
- Erros: `throw new XException(i18nKey('dominio.chave'))`. A chave existe em `src/i18n/locales/*.json`, e o TypeScript confere.
- Ações sensíveis vão para a auditoria: `await this.audit.record(AuditAction.X, { target, metadata })`. Nunca coloque senha ou token no `metadata`.
- Lógica fora de `*.module.ts`, que fica fora da cobertura. Se precisar de lógica num módulo, extraia para um arquivo próprio.
