# Funcionalidades

Rotas sob `/api/v1`. Autenticação e conta estão em [AUTH.md](AUTH.md).

## Usuários (administração)

| Rota | Permissão |
| --- | --- |
| `GET /users?search=ana&sortBy=name&order=asc&role=manager&page=1&limit=20` | `users:read` |
| `GET /users/:id` | `users:read` |
| `POST /users` (cria já com e-mail confirmado, qualquer role) | `users:create` |
| `PATCH /users/:id` (nome, e-mail, idioma, ativo) | `users:update` |
| `PATCH /users/:id/role` | `users:manage-roles` |
| `DELETE /users/:id` / `PATCH /users/:id/restore` | `users:delete` |

- **Busca:** procura em nome **e** e-mail, sem diferenciar maiúsculas. `%` e `_` digitados valem literalmente (não são curingas do SQL).
- **Ordenação:** `createdAt` (padrão), `name` ou `email`, com desempate pelo `id`, então a paginação não repete nem pula registros. `page` vai até 10 000.
- **Exclusão reversível:** o usuário some, as sessões caem e o e-mail fica livre. `?deleted=true` lista os excluídos.
  Depois de 30 dias os dados são anonimizados (ver [AUTH.md](AUTH.md#excluir-a-conta)) e não dá mais para restaurar.
- Um admin não pode mudar a própria role nem se excluir por aqui.
- Admin que troca o e-mail de alguém: o novo endereço precisa ser confirmado, e o antigo é avisado.

## Trilha de auditoria

`GET /audit-logs?action=user.deleted&actorId=...&targetId=...` (permissão `audit:read`).

Cada registro tem `action`, `actorId` (quem fez), `targetType`/`targetId` (em quem), `metadata`, `ip`, `userAgent` e
`requestId` (o mesmo dos logs).

| Grupo | Ações |
| --- | --- |
| Login e segurança | `auth.login` (com `newDevice`), `auth.login_failed` (com o motivo), `auth.logout`, `auth.refresh_token_reuse`, `auth.password_changed`, `auth.password_reset`, `auth.email_verified` |
| 2FA | `auth.2fa_enabled`, `auth.2fa_disabled`, `auth.2fa_failed`, `auth.2fa_recovery_code_used`, `auth.2fa_recovery_codes_regenerated`, `auth.2fa_reset_by_admin` |
| Login social | `auth.social_linked` (com `claimed` quando assumiu conta não confirmada), `auth.social_unlinked` |
| Usuários | `user.registered`, `user.created`, `user.updated` (campos de/para), `user.role_changed`, `user.deleted`, `user.restored`, `user.avatar_changed` |
| Minha conta | `user.email_change_requested`, `user.email_changed`, `user.self_deleted`, `user.data_exported`, `user.anonymized` |
| Sessões | `session.revoked` |

Registrar algo novo:

```ts
await this.audit.record(AuditAction.ORDER_CANCELED, { target: { type: 'order', id }, metadata: { reason } });
```

IP, user agent, requestId e quem fez vêm sozinhos do contexto da requisição. Uma falha ao gravar a auditoria **nunca** derruba a
ação. Registros mais velhos que `AUDIT_RETENTION_DAYS` (365) são apagados pelo job de manutenção.

## Arquivos (upload)

O upload é **genérico**: cada uso (avatar, comprovante, documento) é uma "finalidade" registrada em um único arquivo,
[src/files/file-purposes.ts](../src/files/file-purposes.ts). O arquivo **não passa pela API**: vai direto do navegador para o S3
com uma URL pré-assinada. A Lambda aceita no máximo 6 MB por requisição e cobraria pelo tempo de upload.

```
1. POST /files  { purpose: "avatar", contentType: "image/png", size: 123456 }
   ← { file: { id, status: "pending" }, upload: { url, fields } }
2. o front envia o arquivo para upload.url (multipart: upload.fields + o campo "file")
3. POST /files/:id/complete  → confere tamanho e os primeiros bytes (é mesmo um PNG?) → "ready"
4. usa o arquivo: PUT /users/me/avatar { fileId }
```

| Rota | O que faz |
| --- | --- |
| `GET /files/:id` | Dados + `url` (privado: link temporário de 5 min) |
| `DELETE /files/:id` | Apaga |
| `PUT /users/me/avatar` / `DELETE /users/me/avatar` | Define / remove o avatar |

Segurança:
- tipos aceitos por finalidade (sem SVG/HTML), conteúdo conferido pelos *magic bytes* e tamanho travado na assinatura do upload;
- o caminho no storage é gerado pelo servidor;
- `public/` (ex.: avatar) tem URL aberta; `private/` só por link assinado;
- no máximo `FILES_MAX_PENDING_PER_USER` (20) uploads em aberto por usuário.

**Limpeza automática:** depois de 24 h o job de manutenção apaga os uploads que ficaram `pending` e os concluídos que nada usou
(ex.: enviou a foto e não salvou como avatar). "Usar" = passar por `filesService.consume()`. Finalidades marcadas com
`standalone: true` não precisam ser usadas.

Em dev, `STORAGE_DRIVER=local` imita o S3 (mesmo fluxo, gravando em `tmp/uploads`). Em produção é `s3`.
Para criar uma finalidade nova, veja [GUIDES.md](GUIDES.md#novo-tipo-de-upload).

## E-mails

Cada e-mail é um arquivo `.hbs` **por idioma** em `src/mail/templates/<idioma>/`, dentro do layout compartilhado
`layouts/main.hbs`. O texto puro é gerado automaticamente a partir do HTML.

| Template | Quando |
| --- | --- |
| `verify-email` | Cadastro, reenvio, troca de e-mail (vai para o endereço novo) |
| `welcome` | Primeira confirmação de e-mail |
| `forgot-password` | "Esqueci minha senha" |
| `password-changed` | Senha trocada/redefinida |
| `role-changed` | Admin mudou a role |
| `new-login`, `two-factor-changed`, `social-linked`, `email-changed`, `account-deleted` | Alertas de segurança ([AUTH.md](AUTH.md#alertas-de-segurança-por-e-mail)) |

- **Idioma:** os e-mails saem no idioma salvo do usuário (`locale`), não no da requisição que os disparou. Assuntos em `src/i18n/locales/*.json` (`mail.subjects.*`).
- **Variáveis globais:** `appName`, `appUrl`, `frontendUrl`, `supportEmail`, `subject`. **Helpers:** `{{year}}`, `{{upper x}}`, `{{eq a b}}`, `{{concat a b}}`. **Partials:** `{{> button url=... label="..."}}`, `{{> footer}}`.
- **Segurança:** todo valor é escapado (`{{ }}`). Nunca use `{{{ }}}` com dado do usuário.
- `npm run mail:preview` gera o HTML de todos os e-mails em todos os idiomas, para ver no navegador.
- Um teste garante que todo idioma tem todos os templates.

**Transporte** (`MAIL_TRANSPORT`): `smtp` (Mailpit em dev, ou qualquer provedor), `ses` (Lambda, usa a IAM role), `json` (não envia, só para testes).

**Entrega** (`MAIL_DELIVERY`):

| | `sync` (dev) | `sqs` (Lambda) |
| --- | --- | --- |
| Quando sai | durante a requisição | a API publica na fila; a Lambda `mailWorker` envia |
| Provedor lento | deixa a requisição lenta | não afeta a API |
| Provedor fora | e-mail perdido (fica no log) | tenta de novo; após 5 falhas vai para a **DLQ** (14 dias) e dispara alarme |

## Idiomas (i18n)

O cliente envia o header `Accept-Language`. Erros e validações voltam traduzidos (`en`, `pt-BR`). Variações caem no idioma base
(`pt-PT` → `pt-BR`), e sem header vale `FALLBACK_LANGUAGE`. Traduções em `src/i18n/locales/*.json`; um teste garante que todos os
idiomas têm as mesmas chaves e os mesmos `{placeholders}`. Novo idioma: [GUIDES.md](GUIDES.md#novo-idioma).

## Rate limiting

| Limite | Onde | Padrão |
| --- | --- | --- |
| Geral, por IP | todas as rotas | 100 / 60 s |
| Rígido, por IP | rotas `@AuthRateLimit()`: login, cadastro, senha, e-mail, 2FA, login social, minha conta | 20 / 15 min |
| Rígido, por e-mail | as mesmas, quando o corpo tem `email` | 5 / 15 min |
| Por usuário | código 2FA e senha de confirmação (reautenticação) | 10 / 15 min |

- Estourou: **429** `errors.tooManyRequests` ("tente novamente em X segundos") + header `Retry-After-<limite>`.
- Os contadores ficam no banco (`rate_limits`), não na memória. Com várias Lambdas, cada uma teria a sua contagem e o limite não valeria.
- O IP real depende de `TRUST_PROXY` (0 na Lambda, 1 atrás de um ALB).
- Contra volume alto (DDoS), use também o throttling do API Gateway e/ou o AWS WAF, que barram antes de chegar na Lambda.

## Job de manutenção

Roda a cada 6 h (Lambda `maintenance`) ou com `npm run maintenance`. Cada tarefa é isolada: se uma falha, as outras seguem, e a
execução termina com erro para disparar o alarme.

| Tarefa | Configuração |
| --- | --- |
| Anonimizar contas excluídas | `ACCOUNT_PURGE_AFTER_DAYS` (30) |
| Apagar uploads abandonados | `FILES_CLEANUP_AFTER_HOURS` (24), `FILES_CLEANUP_BATCH_SIZE` (500) |
| Apagar sessões encerradas/expiradas e refresh tokens velhos | `SESSIONS_RETENTION_DAYS` (30) |
| Apagar auditoria antiga | `AUDIT_RETENTION_DAYS` (365; 0 = nunca) |
| Apagar contadores de rate limit expirados | — |

Devolve um relatório, por exemplo `{ "anonymizedAccounts": 1, "deletedUploads": 3, ... }`. Nova tarefa: [GUIDES.md](GUIDES.md#nova-tarefa-agendada).

## Logs e X-Request-Id

- Toda requisição tem um id: o `X-Request-Id` do cliente (se for válido) ou um gerado. Ele volta no header, no `requestId` de todo erro e
  em toda linha de log.
- Logs em **JSON** em produção (prontos para o CloudWatch Logs Insights) e legíveis em dev. Nível em `LOG_LEVEL`.
- **Nunca** são logados: headers (tokens), corpos (senhas) e e-mails completos (aparecem mascarados: `ma***@x.com`).

```
fields @timestamp, msg, res.statusCode, responseTime, userId
| filter requestId = "8f1c..."
| sort @timestamp desc
```

## Health check

`GET /api/health` (público, fora do versionamento) confere a API e o banco. É usado pelo Docker/ECS e por monitores externos.
