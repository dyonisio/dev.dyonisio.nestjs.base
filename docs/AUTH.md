# Autenticação e conta

> Os comandos `npm` e os caminhos deste guia (`.env`, `serverless.yml`, `src/...`) são da API: rode-os em `apps/api`.

Todas as rotas abaixo estão sob `/api/v1`. Os exemplos completos (corpo, respostas, erros) estão no Swagger (`/docs`).

## Visão geral do login

```
cadastro ─▶ e-mail "confirme" ─▶ /auth/email/verify ─▶ conta confirmada
                                                            │
login (senha, link mágico ou Google/Apple) ──┬── sem 2FA ─▶ tokens
                                             └── com 2FA ─▶ desafio ─▶ /auth/2fa/verify ─▶ tokens
login com passkey ─────────────────────────────────────────▶ tokens (já vale como 2 fatores)
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

### Refresh token em cookie (front web)

Um cliente web pode pedir o refresh token num **cookie `httpOnly`** em vez de no corpo, mandando o cabeçalho
`X-Session-Cookie: 1` (e `credentials: 'include'` no `fetch`):

- toda resposta que traz um refresh token (login, cadastro, 2FA, social, link mágico, refresh, troca e criação de senha)
  o grava no cookie e **o tira do corpo**;
- `POST /auth/refresh` e `POST /auth/logout` aceitam corpo vazio: usam o cookie. O logout apaga o cookie, e um refresh
  recusado também;
- o cookie é `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth` e, em produção (HTTPS), `Secure` com o nome
  `__Secure-refresh`.

**Por que é seguro contra outro site:** o cookie só é lido quando o cabeçalho `X-Session-Cookie` vem junto, e outro site
não consegue enviar um cabeçalho próprio sem passar pelo CORS (que só libera a origem do `CORS_ORIGIN`). O `SameSite=Strict`
nem deixa o navegador mandar o cookie a partir de outro site. Isso exige o front e a API no **mesmo site** (mesmo domínio
registrado, como `base.dyonisio.dev` e `api.base.dyonisio.dev`).

Sem o cabeçalho (apps mobile, integrações), nada muda: o token vem no corpo, como acima. O CORS libera credenciais
(`credentials: true`); por isso `CORS_ORIGIN=*` é recusado em produção.
| Troca/redefinição de senha | Encerra **todas** as sessões (a troca devolve um par novo para quem trocou) |
| Usuário desativado ou excluído | Todas as sessões caem |
| Sessão com mais de `SESSION_MAX_AGE_DAYS` (90) | Expira, mesmo se usada todo dia: login de novo |

**Meus dispositivos:** `GET /users/me/sessions` lista as sessões ativas (navegador, IP, último uso, `current`).
`DELETE /users/me/sessions/:id` encerra uma. `DELETE /users/me/sessions` encerra todas as outras.

**Sessões de outra pessoa (admin):** para o "acho que invadiram minha conta". `GET /users/:id/sessions`
(`users:read`) lista; `DELETE /users/:id/sessions/:sessionId` encerra uma e `DELETE /users/:id/sessions`
encerra todas (`users:update`). Fica na auditoria como `session.revoked` com `byAdmin: true`, e a sessão
fica com o motivo `revoked-by-admin`. A senha **não** muda: se for invasão, a pessoa ainda precisa trocá-la
(ou o admin desativa a conta). No painel: página do usuário → "Dispositivos conectados".

**Formas de login de outra pessoa (admin):** encerrar as sessões não basta se o invasor cadastrou uma passkey ou
vinculou um Google — ele entraria de novo. `GET /users/:id/login-methods` (`users:read`) mostra se há senha (nunca a
senha), os Google/Apple vinculados e as passkeys; `DELETE /users/:id/passkeys/:passkeyId` e
`DELETE /users/:id/identities/:provider` removem (`users:update`), com `byAdmin: true` na auditoria. Desvincular não
tem a trava de "última forma de login": a pessoa sempre pode entrar pelo link mágico ou criar uma senha pelo "esqueci
a senha". No painel: página do usuário → "Formas de login".

**Roteiro "invadiram minha conta":** 1) Formas de login: remova o que a pessoa não reconhece; 2) Dispositivos
conectados: "Desconectar de todos"; 3) peça para a pessoa trocar a senha (ou desative a conta até falar com ela).

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
| `POST /auth/password/set { newPassword, code? }` | **Primeira** senha de quem está logado sem ter uma (veja abaixo) |

Contas sem senha (criadas pelo Google/Apple, por um admin sem informar a senha, ou que entraram pelo link mágico antes de
confirmar o e-mail) criam a primeira de dois jeitos:

- pelo link do convite ou do "esqueci a senha" (`/reset-password`);
- logadas, em `POST /auth/password/set`. Só vale para conta **sem** senha (trocar uma senha existente exige a atual), com
  login recente (`REAUTH_WINDOW_SECONDS`) e, com 2FA, o código. Assim um token roubado não consegue "plantar" uma senha
  para voltar depois. Encerra as outras sessões e devolve um par novo.

A primeira senha não gera o e-mail de "senha alterada". Na conta convidada (criada por um admin) ela manda o
**Bem-vindo**: essa conta já nasce com o e-mail confirmado e nunca passa pela confirmação, que é onde ele sai nas outras.

## Link mágico (entrar sem senha)

A pessoa informa só o e-mail e entra pelo link que chega nele:

| Rota | Uso |
| --- | --- |
| `POST /auth/magic-link { email }` | Manda o link `FRONTEND_URL/magic-link?token=...` (15 min, `MAGIC_LINK_EXPIRES_IN`). Sempre 200, exista o e-mail ou não |
| `POST /auth/magic-link/verify { token }` | Troca o link pela sessão, ou pelo desafio do 2FA |

**Digitar o e-mail não basta para entrar.** O pedido nunca abre sessão: só manda o link para a caixa da conta, e a prova
é ter acesso a ela. Além disso:

- **Uso único:** o link carrega um *nonce* guardado no usuário, e usar o link o apaga numa UPDATE atômica. Dois cliques
  ao mesmo tempo: só um entra.
- **Um link por vez:** pedir outro troca o nonce e invalida o anterior. Trocar o e-mail da conta também.
- **2FA continua valendo:** com 2FA ativo, o link leva ao código do app, como o login por senha.
- **Sem revelar contas:** a resposta é a mesma exista o e-mail ou não. Conta desativada não recebe link.
- **Sem lotar a caixa de ninguém:** `@AuthRateLimit` limita por IP e por e-mail (`RATE_LIMIT_AUTH_*`).
- **Pré-sequestro:** se a conta nunca foi confirmada, abrir o link prova o e-mail, e a senha, o 2FA e as sessões de quem
  a criou são descartados (como no login social). A pessoa cria a própria senha em seguida.
- **Filtros de e-mail:** antivírus abrem os links para conferir. Por isso a tela `/magic-link` do front pede um clique
  em "Entrar" (um POST), em vez de entrar sozinha ao abrir, e o filtro não gasta o link.
- O e-mail mostra de qual dispositivo e IP o link foi pedido, e o "Novo acesso" continua saindo para dispositivo novo.

Quem entrou pelo link numa conta sem senha e sem Google/Apple (o convidado, por exemplo) é levado pelo front para
`/create-password` antes de usar o painel.

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

No app autenticador, a conta aparece com o nome do `APP_NAME` (o *issuer*) e o e-mail. O QR também leva um ícone
(`TOTP_IMAGE_URL`; padrão: `FRONTEND_URL/icon.png`, publicado pelo front), mas só alguns apps o mostram (FreeOTP, 2FAS,
Aegis). Google Authenticator, Microsoft Authenticator e Authy ignoram o ícone e mostram só o nome.

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

## Passkeys (digital, rosto ou PIN do aparelho)

A pessoa entra **sem e-mail e sem senha**: o navegador mostra as passkeys salvas para o site e ela confirma com a
digital, o rosto ou o PIN. A chave privada fica no aparelho (ou no gerenciador de senhas: iCloud, Google, 1Password…);
a API guarda só a chave pública (tabela `passkeys`). Biblioteca: `@simplewebauthn/server` e, no front, `/browser`.

| Rota | O que faz |
| --- | --- |
| `POST /auth/passkeys/login/options` | Público. Devolve as opções para o navegador e um `challengeToken` |
| `POST /auth/passkeys/login { challengeToken, response }` | Público. Confere a assinatura e abre a sessão |
| `POST /auth/passkeys/register/options` + "confirme que é você" | Logado. Opções para criar a passkey |
| `POST /auth/passkeys/register { challengeToken, response, name? }` | Salva a passkey e manda o e-mail `passkey-added` |
| `GET /users/me/passkeys`, `PATCH`/`DELETE /users/me/passkeys/:id` | Listar, renomear, remover |

Regras:

- **Sem passo de 2FA** no login com passkey: ela exige verificação do usuário (biometria/PIN), então já prova dois
  fatores (o aparelho e a pessoa). Senha e link mágico continuam pedindo o código.
- **Cadastrar pede "confirme que é você"** (senha e 2FA), como trocar o e-mail: com um access token roubado não dá
  para plantar uma passkey e manter acesso. E o dono recebe um e-mail.
- **Desafio de uso único**: vai num JWT de 5 min (sem tabela) e é "queimado" no `rate_limits` ao ser usado; a mesma
  resposta não entra duas vezes. Contador de assinaturas que volta para trás (credencial clonada) é recusado.
- **Presa ao domínio do front**: `rpId` = domínio do `FRONTEND_URL` (ex.: `base.dyonisio.dev`), e só respostas
  vindas do `FRONTEND_URL` são aceitas. Um site falso não consegue usá-la (por isso passkey não cai em phishing).
  Para outro domínio/origem: `WEBAUTHN_RP_ID` e `WEBAUTHN_ORIGINS` (separadas por vírgula). **Trocar o domínio do
  front invalida as passkeys existentes.**
- Conta excluída ou desativada não entra; ao anonimizar a conta, as passkeys são apagadas. Elas também contam como
  forma de entrar ao desvincular o Google/Apple.
- Limite de 20 passkeys por conta.

No front: botão "Entrar com passkey" no login (some se o navegador não suporta) e a seção "Passkeys" em Segurança.
Em desenvolvimento funciona em `http://localhost` (o navegador aceita localhost sem HTTPS).

## Minha conta

### Confirmar que é você (reautenticação)

Ações sensíveis pedem prova de identidade, porque um access token roubado (XSS, celular desbloqueado) não pode bastar:

| Tipo de conta | O que enviar |
| --- | --- |
| Com senha | `currentPassword` |
| Sem senha (só Google/Apple) | nada, mas o login precisa ter sido há menos de `REAUTH_WINDOW_SECONDS` (10 min). Senão: **401 `account.reauthRequired`** e o front pede para entrar de novo |
| Com 2FA (qualquer uma) | também `code` |
| Com passkey (qualquer uma) | **ou**, no lugar de tudo acima: `passkey: { challengeToken, response }` — o desafio vem de `POST /auth/passkeys/reauth/options` e só aceita passkeys da própria conta. Vale pela senha **e** pelo código (a passkey já prova os dois fatores) |

Usado em: trocar e-mail, excluir a conta, ativar o 2FA, adicionar uma passkey. No front, a janela mostra
"Confirmar com passkey" quando a conta tem uma e o navegador suporta. Também tem limite de 10 tentativas de senha a cada 15 min por usuário.

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

**Troca feita pelo admin** (`PATCH /users/:id { email }`): segue o mesmo caminho. O endereço novo vira `pendingEmail` e
recebe o link, e a conta **continua com o e-mail atual** (login, "esqueci a senha" e link mágico) até o link ser aberto.
Um endereço digitado errado nunca é confirmado, então não entrega a conta a um estranho. A auditoria registra o pedido
(`user.email_change_requested`, com o admin como autor) e, depois, a troca (`user.email_changed`).

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
| `passkey-added` | Passkey adicionada à conta |
| `account-deleted` | Conta excluída, com a data da exclusão definitiva |

Os botões levam a `FRONTEND_URL/account/security`.
