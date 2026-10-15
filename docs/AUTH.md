# Autenticação e conta

Todas as rotas abaixo estão sob `/api/v1`. Os exemplos completos (corpo, respostas, erros) estão no Swagger (`/docs`).

## Visão geral do login

```
cadastro ─▶ e-mail "confirme" ─▶ /auth/email/verify ─▶ conta confirmada
                                                            │
login (senha ou Google/Apple) ──┬── sem 2FA ──────────────▶ tokens
                                └── com 2FA ─▶ desafio ─▶ /auth/2fa/verify ─▶ tokens
tokens ─▶ usa o accessToken ─▶ expirou (401) ─▶ /auth/refresh ─▶ novo par
```

## Tokens e sessões

O login devolve:

```json
{
  "accessToken": "eyJ...",              // JWT curto (JWT_EXPIRES_IN, padrão 15 min)
  "refreshToken": "<uuid>.<segredo>",   // opaco, de uso único (sessão de até 30 dias, renovada a cada uso)
  "tokenType": "Bearer",
  "expiresIn": 900,
  "refreshExpiresIn": 2592000,
  "user": { "...": "..." }
}
```

**No front:** mande `Authorization: Bearer <accessToken>`. Quando der 401, chame `POST /auth/refresh { refreshToken }`
e guarde **o novo par**. O refresh token antigo deixa de valer.

Cada login abre uma **sessão** (um dispositivo). O access token carrega o id dela (`sid`), e a API confere a sessão a cada
requisição. Por isso logout, troca de senha e "encerrar dispositivo" derrubam também os access tokens na hora.

| Evento | Efeito |
| --- | --- |
| `POST /auth/refresh` | Rotação: o refresh token é consumido e um par novo é emitido na mesma sessão |
| Refresh token já usado aparece de novo | Indício de roubo: **a sessão é revogada** (o ladrão e a vítima precisam logar de novo) e fica na auditoria |
| `POST /auth/logout { refreshToken }` | Encerra a sessão |
| Troca/redefinição de senha | Encerra **todas** as sessões (a troca devolve um par novo para quem trocou) |
| Usuário desativado ou excluído | Todas as sessões caem |
| Sessão com mais de `SESSION_MAX_AGE_DAYS` (90) | Expira, mesmo se usada todo dia: login de novo |

**Meus dispositivos:** `GET /users/me/sessions` lista as sessões ativas (navegador, IP, último uso, `current`).
`DELETE /users/me/sessions/:id` encerra uma. `DELETE /users/me/sessions` encerra todas as outras.

> Toda requisição autenticada faz 1 consulta ao banco (sessão + usuário). É o preço de revogar na hora; com o
> pool de conexões e o índice, custa poucos milissegundos.

## Cadastro e confirmação de e-mail

1. `POST /auth/register { name, email, password }` cria a conta (sempre com role `user`), já devolve os tokens e manda o
   link `FRONTEND_URL/verify-email?token=...` (válido por 24 h).
2. O front lê o token e chama `POST /auth/email/verify { token }`. O e-mail de boas-vindas sai nesse momento.
3. Até confirmar, o usuário só acessa as rotas `@AllowUnverified()` (perfil, reenviar link, senha, minha conta). As outras
   respondem **403 `auth.emailNotVerified`**, inclusive as que você criar.
4. Reenviar: `POST /auth/email/resend`.

Regras de entrada: nome só com letras, espaços, apóstrofo, hífen e ponto (sem números ou links, porque o nome aparece nos e-mails);
senha com 8+ caracteres, letra e número.

## Senha

| Rota | Uso |
| --- | --- |
| `POST /auth/password/forgot { email }` | Manda o link `FRONTEND_URL/reset-password?token=...` (15 min). Sempre responde 200, exista o e-mail ou não |
| `POST /auth/password/reset { token, password }` | Define a nova senha. O link vale **uma vez**: o segredo dele depende do hash da senha atual |
| `POST /auth/password/change { currentPassword, newPassword }` | Troca estando logado |

Contas criadas pelo Google/Apple não têm senha. Para criar uma, usam o "esqueci minha senha".

## 2FA (verificação em duas etapas)

Padrão **TOTP**: o código de 6 dígitos de qualquer app autenticador (Google Authenticator, Authy, 1Password...).

| Rota | O que faz |
| --- | --- |
| `POST /auth/2fa/setup { currentPassword }` | Gera o segredo. Devolve `otpauthUrl` (mostre como QR code) e `secret` (digitação manual). **Pede a senha**: um token roubado não consegue ativar o 2FA e trancar o dono fora |
| `POST /auth/2fa/enable { code }` | Confirma com o primeiro código e ativa. Devolve **10 códigos de recuperação**, mostrados uma única vez |
| `POST /auth/2fa/verify { twoFactorToken, code }` | Segunda etapa do login (pública) |
| `POST /auth/2fa/disable { code }` | Desativa |
| `POST /auth/2fa/recovery-codes { code }` | Gera códigos novos (exige o código do app) |
| `DELETE /users/:id/two-factor` | Admin (`users:reset-2fa`): para quem perdeu o celular **e** os códigos |

Com 2FA ativo, o login (senha **ou** social) não devolve tokens:

```json
{ "twoFactorRequired": true, "twoFactorToken": "eyJ...", "expiresIn": 300 }
```

O front pede o código e chama `/auth/2fa/verify`. O `code` aceita o do app (`123456`) ou um de recuperação (`ABCD-EFGH`).

Proteções:
- o segredo fica cifrado no banco (AES-256-GCM);
- o mesmo código não vale duas vezes, nem em requisições simultâneas;
- no máximo 10 erros a cada 15 min por usuário;
- os códigos de recuperação são guardados só como hash;
- o dono é avisado por e-mail quando o 2FA é ligado ou desligado.

## Login social (Google e Apple)

O front faz o login com o SDK oficial (Google Identity Services, Sign in with Apple), recebe um **ID token** e envia:

```http
POST /auth/social/google
{ "idToken": "eyJ...", "nonce": "recomendado", "name": "a Apple só manda o nome no 1º login" }
```

A API confere a assinatura (chaves públicas do provedor), o emissor, a **audiência** (um dos seus client IDs: token de outro
app é recusado), a validade e o nonce. Depois:

| Situação | O que acontece |
| --- | --- |
| Esse Google/Apple já está vinculado | Entra na conta vinculada |
| Já existe conta **confirmada** com esse e-mail | Vincula, entra, e o dono recebe um e-mail avisando |
| Já existe conta **não confirmada** com esse e-mail | O dono real do e-mail (provado pelo Google/Apple) **assume** a conta: a senha, o 2FA e as sessões de quem a criou são descartados. Isso bloqueia o "pré-sequestro", em que alguém cadastra o e-mail da vítima antes dela |
| E-mail novo | Cria a conta (confirmada, sem senha) |
| Provedor não confirmou o e-mail | Recusa (400) |

Ligar: `GOOGLE_CLIENT_IDS` e/ou `APPLE_CLIENT_IDS` (separados por vírgula: web, iOS, Android). Vazio = desligado.
Gestão: `GET /users/me/identities` e `DELETE /users/me/identities/:provider` (não deixa remover a última forma de entrar).

## Minha conta

### Confirmar que é você (reautenticação)

Ações sensíveis pedem prova de identidade, porque um access token roubado (XSS, celular desbloqueado) não pode bastar:

| Tipo de conta | O que enviar |
| --- | --- |
| Com senha | `currentPassword` |
| Sem senha (só Google/Apple) | nada, mas o login precisa ter sido há menos de `REAUTH_WINDOW_SECONDS` (10 min). Senão: **401 `account.reauthRequired`** e o front pede para entrar de novo |
| Com 2FA (qualquer uma) | também `code` |

Usado em: trocar e-mail, excluir a conta, ativar o 2FA. Também tem limite de 10 tentativas de senha a cada 15 min por usuário.

### Trocar o e-mail

```http
POST /users/me/email
{ "newEmail": "novo@x.com", "currentPassword": "...", "code": "123456 (se tiver 2FA)" }
```

1. Responde **202** e guarda `pendingEmail`. **A conta continua com o e-mail antigo.**
2. O endereço novo recebe o link `/verify-email?token=...`, o mesmo endpoint da confirmação de cadastro.
3. Ao confirmar, o e-mail muda e **o endereço antigo é avisado**. Um pedido mais novo invalida o link do anterior.

Assim ninguém troca o e-mail para um endereço que não controla, e quem roubou um token não consegue redirecionar o
"esqueci minha senha" para si. `PATCH /users/me` **não** aceita `email`.

### Excluir a conta

```http
DELETE /users/me
{ "currentPassword": "...", "code": "123456 (se tiver 2FA)" }
```

- **Na hora:** a conta some (soft delete), todas as sessões caem, o e-mail fica livre e chega um e-mail com a data da exclusão definitiva.
- **Depois de `ACCOUNT_PURGE_AFTER_DAYS` (30 dias):** o job de manutenção **anonimiza**. Nome e e-mail viram genéricos; senha, 2FA,
  avatar, arquivos, vínculos com Google/Apple, sessões e IP/navegador da auditoria são apagados. O registro continua (sem
  identificar ninguém) para não quebrar a auditoria.
- Até a anonimização, um admin pode restaurar (`PATCH /users/:id/restore`). Depois, não.
- O único admin não pode se excluir (promova outra pessoa antes).
- Vale também para exclusões feitas por admin.

### Baixar meus dados

`GET /users/me/export` devolve um JSON (download) com perfil, formas de login, sessões, arquivos e atividade (auditoria).
Nunca inclui senha, segredo do 2FA ou tokens. É o direito de acesso da LGPD.

## Alertas de segurança por e-mail

Avisam o dono quando algo sensível acontece, para ele reagir se não foi ele:

| E-mail | Quando |
| --- | --- |
| `new-login` | Login de um dispositivo (navegador/app) que a conta ainda não tinha usado. O primeiro login da conta não conta |
| `password-changed` | Senha trocada ou redefinida |
| `email-changed` | E-mail trocado (vai para o endereço **antigo**) |
| `two-factor-changed` | 2FA ligado ou desligado (inclusive pelo admin) |
| `social-linked` | Google/Apple vinculado a uma conta existente |
| `account-deleted` | Conta excluída, com a data da exclusão definitiva |

Os botões levam a `FRONTEND_URL/account/security`.
