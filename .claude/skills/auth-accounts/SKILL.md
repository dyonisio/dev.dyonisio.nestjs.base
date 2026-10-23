---
name: auth-accounts
description: Mapa da autenticação e da conta neste repositório — login por senha, link mágico, Google/Apple e passkeys, 2FA, sessões checadas no banco com refresh token rotativo (e cookie no front), confirmação de identidade (reauth), troca de e-mail, exclusão/anonimização, exportação de dados, alertas por e-mail e o que o admin vê das formas de login e sessões. Use ao mexer em login, sessão, segurança da conta ou "minha conta".
---

# Autenticação e conta

Guia completo (fluxos, rotas, regras): `docs/AUTH.md`. Proteções e trade-offs: `docs/SECURITY.md`.

## Onde fica

| Pasta (`apps/api/src`) | O quê |
| --- | --- |
| `auth/controllers`, `auth/services` | Login, cadastro, senha, e-mail, link mágico |
| `auth/two-factor/` | TOTP, desafio, códigos de recuperação (segredo cifrado com `ENCRYPTION_KEY`) |
| `auth/social/` | Google/Apple (verificador OIDC; `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`) |
| `auth/passkeys/` | WebAuthn (`@simplewebauthn/server`) |
| `auth/session-cookie.ts` | Refresh token em cookie httpOnly quando vem `X-Session-Cookie: 1` |
| `auth/admin-login-methods.controller.ts` | Admin vê/remove passkeys e vínculos sociais de um usuário |
| `sessions/` | Sessões + refresh tokens; `admin-sessions.controller.ts` (admin encerra sessões) |
| `users/account/` | Minha conta: `reauth.service.ts`, exportar, excluir, `account-purge.service.ts` (anonimização) |
| `common/guards/jwt-auth.guard.ts` | Confere JWT **e** a sessão no banco a cada requisição |

Front: `apps/web/src/auth/` (`AuthProvider`, `session.ts`, `passkey.ts`, `login-methods.ts`),
`components/Reauth.tsx`, `components/SocialLogin.tsx`, telas em `pages/` e `pages/account/SecurityPage.tsx`.

## Invariantes (não quebre)

- **Sessão no banco**: o access token (15 min) leva o `sid`; logout, troca de senha e "encerrar dispositivo" valem
  na hora. Não migrar para JWT stateless sem o usuário pedir.
- **Refresh token de uso único** (rotação). Reuso = suspeita de roubo → sessão revogada + auditoria.
- **Role lida do banco** a cada requisição (mudar a role vale na hora).
- **Passkey** dispensa o 2FA (já são dois fatores). Ela fica presa ao domínio do `FRONTEND_URL` (`rpId`): trocar o
  domínio do front invalida as passkeys, e em produção o `FRONTEND_URL` tem que ser https (validado no boot).
- **Reauth** ("confirme que é você") antes de trocar e-mail, excluir conta, ativar 2FA, cadastrar passkey: senha
  (+ código, se tiver 2FA), ou passkey, ou login recente (< `REAUTH_WINDOW_SECONDS`) para conta só social.
  Reutilize `ReauthService` / `<ReauthFields>` / `ReauthDialog` numa ação sensível nova
  (`docs/GUIDES.md` → "Ação sensível com confirmação de identidade").
- Login com Google confirma o e-mail da conta. Desvincular o social é permitido mesmo sendo a única forma de
  entrar (ainda há link mágico/"esqueci a senha").
- Alertas de segurança por e-mail: novo dispositivo, 2FA ligado/desligado, social vinculado, passkey adicionada,
  e-mail trocado (para o endereço antigo), conta excluída.
- **Exportar meus dados** (`account.service.ts` → `exportData`) junta tudo da pessoa só com campos seguros (inclui
  compras e assinaturas, sem ids das plataformas). Tabela nova com dado pessoal: acrescente lá e no teste.
- Excluir conta = soft delete; o job de manutenção anonimiza depois do prazo (apaga arquivos, sessões, passkeys).

## Testes

Unit ao lado do código (`*.spec.ts`); e2e em `test/` (`app`, `account`, `passkeys`, `sessions`,
`session-cookie`, `social-login`, `two-factor`, `magic-link`, `email-verification`, `users-admin`). As pastas
auth, sessions e users/account têm limite de cobertura próprio (95/90): cubra cada ramo novo.
