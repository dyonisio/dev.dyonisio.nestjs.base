# Front (`apps/web`)

O front da base: **React 19 + Vite + React Router**, em TypeScript. É um site estático (HTML + JS), que fala com
a API direto do navegador. Não tem servidor próprio, então hospedar custa quase nada (S3 + CloudFront).

Todos os comandos abaixo rodam em `apps/web`.

## Rodar localmente

Com a API rodando em `http://localhost:3000` (veja o [README](../README.md#começando-5-minutos)):

```bash
npm install
```

```bash
npm run dev
```

Abra http://localhost:5173. Para apontar para outra API, crie `apps/web/.env` a partir do `.env.example`:

```
VITE_API_URL=https://api.exemplo.com
```

> Tudo que começa com `VITE_` vai **para dentro do JavaScript** que o navegador baixa. Nunca coloque segredo aí.

A API precisa aceitar a origem do front no CORS. Em desenvolvimento, o `.env.example` da API já libera tudo
(`CORS_ORIGIN=*`) e aponta os links dos e-mails para `FRONTEND_URL=http://localhost:5173`. Em produção, configure
`CORS_ORIGIN` e `FRONTEND_URL` com o endereço real do site (veja [DEPLOY_AWS_LAMBDA.md](DEPLOY_AWS_LAMBDA.md)).

## Telas

### Públicas

| Rota | Tela | Observação |
| --- | --- | --- |
| `/login` | Login | E-mail e senha, ou Google/Apple. Em dois passos quando a conta tem 2FA (código do app ou de recuperação) |
| `/register` | Cadastro | Também com Google/Apple |
| `/forgot-password` | Esqueci a senha | A API responde igual exista o e-mail ou não |
| `/reset-password?token=` | Nova senha | Link do "esqueci a senha" **e** do convite do admin ("crie sua senha") |
| `/verify-email?token=` | Confirmação de e-mail | Link do cadastro e da troca de e-mail; confirma sozinho ao abrir |

### Logadas (menu no topo)

| Rota | Tela | O que tem |
| --- | --- | --- |
| `/` | Início | Saudação, aviso de e-mail não confirmado (com "reenviar"), convite para ativar o 2FA, atalhos |
| `/account` | Minha conta | Foto (upload direto para o S3), nome e idioma, troca de e-mail (confirmada pelo endereço novo), troca de senha. Conta sem senha (só Google/Apple) recebe um link para criar uma |
| `/account/security` | Segurança | 2FA (QR code, códigos de recuperação, gerar novos, desativar), dispositivos conectados (desconectar um ou todos os outros), formas de login (desvincular Google/Apple) |
| `/account/privacy` | Privacidade | Baixar meus dados (JSON) e excluir a conta |
| `/admin/users` | Usuários | `users:read`. Busca, filtro por role, ordenação, paginação, excluídos (com "restaurar"), criar usuário/convite |
| `/admin/users/:id` | Detalhe do usuário | Dados e conta ativa (`users:update`), role (`users:manage-roles`), reenviar convite (`users:create`), desligar 2FA (`users:reset-2fa`), excluir (`users:delete`), atividade (`audit:read`) |
| `/admin/audit` | Auditoria | `audit:read`. Filtro por ação, por quem fez e pelo alvo; paginação |

Cada item de admin só aparece para quem tem a permissão. Abrir a rota direto sem permissão mostra "acesso negado".
A API também confere, então esconder é só conforto: não é a proteção.

Ações sensíveis (trocar e-mail, ativar 2FA, excluir a conta) pedem **confirmação de identidade**: a senha atual
e, com 2FA ativo, o código do app. Isso fica no componente `ReauthFields`
([docs/AUTH.md → Confirmar que é você](AUTH.md#confirmar-que-é-você-reautenticação)).

As rotas que recebem links dos e-mails (`/login`, `/reset-password`, `/verify-email`, `/account/security`) precisam
ter exatamente esses nomes: é a API que monta os links, com o `FRONTEND_URL` na frente.

## Login social (Google e Apple)

Os botões aparecem só quando o client ID está configurado no `apps/web/.env` (e, no deploy, nas variáveis do build):

```
VITE_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
VITE_APPLE_CLIENT_ID=com.exemplo.web
VITE_APPLE_REDIRECT_URI=https://app.exemplo.com
```

- Use **os mesmos** client IDs que estão em `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` na API. Um token emitido para outro
  client ID é recusado.
- **Google:** no Google Cloud Console, no client OAuth do tipo "Web", cadastre a origem do site
  (`http://localhost:5173` e o domínio de produção) em "Authorized JavaScript origins".
- **Apple:** use um *Services ID* com "Sign in with Apple" ligado, com o domínio e a URL de retorno cadastrados.
  A Apple só aceita domínios com HTTPS, então teste a Apple no ambiente publicado.
- Os SDKs oficiais são carregados do Google (`accounts.google.com`) e da Apple (`appleid.cdn-apple.com`) **só** quando
  o botão está ligado. Se o site tiver uma CSP, libere esses dois endereços.

O código fica em [SocialLogin.tsx](../apps/web/src/components/SocialLogin.tsx). Cada login gera um *nonce* novo, que a API
confere: um ID token capturado não serve para outro login.

## Como está organizado

```
src/
├── main.tsx                # monta o app: roteador, idioma e sessão
├── App.tsx                 # a lista de rotas
├── config.ts               # VITE_API_URL e client IDs do login social
├── api/
│   ├── schema.d.ts         # GERADO do apps/api/openapi.json (npm run api:types) — não edite
│   ├── client.ts           # o cliente `api` (token, idioma, refresh automático)
│   └── upload.ts           # upload em 3 passos (pede a URL, envia ao S3, confirma)
├── auth/
│   ├── session.ts          # onde os tokens ficam
│   ├── permissions.ts      # can(user, 'users:read'), roles
│   └── AuthProvider.tsx    # useAuth(): login (senha/social), 2FA, cadastro, logout, usuário atual
├── i18n/                   # textos da interface (pt-BR, en) e idioma atual
├── lib/
│   ├── hooks.ts            # useQuery (carregar dados) e useAction (salvar com "carregando" e erro)
│   ├── format.ts           # datas no idioma, tamanho de arquivo, nome do dispositivo
│   └── flash.ts            # aviso para a próxima tela (ex.: "conta excluída")
├── components/
│   ├── ui.tsx              # Section, Field, SelectField, Modal, ConfirmDialog, Avatar, Badge, Pager...
│   ├── Layout.tsx          # menu das telas logadas + RequirePermission
│   ├── RequireAuth.tsx     # protege rotas: sem sessão → /login (e volta depois)
│   ├── Reauth.tsx          # "confirme que é você" (senha e/ou código do 2FA)
│   └── SocialLogin.tsx     # botões do Google e da Apple
├── pages/                  # telas públicas e início
│   ├── account/            # minha conta, segurança, privacidade
│   └── admin/              # usuários, detalhe do usuário, auditoria
└── styles.css              # tema (cores em variáveis CSS, claro/escuro automático)
```

### Carregar e salvar dados

```tsx
// carrega ao abrir a tela (e de novo com reload())
const sessions = useQuery(() => api.GET('/api/v1/users/me/sessions'), []);

// salva com "carregando" e erro prontos
const { run, busy, error } = useAction();
const save = () =>
  void run(async () => {
    const { data, error: apiError } = await api.PATCH('/api/v1/users/me', { body: { name } });
    if (apiError || !data) throw apiError;
    session.setUser(data);
  });
```

### Chamando a API

O cliente é **tipado pelo contrato**: rota, corpo e resposta errados viram erro de compilação.

```ts
import { api } from '../api/client';

const { data, error } = await api.GET('/api/v1/users/me');
const { error } = await api.PATCH('/api/v1/users/me', { body: { name: 'Jane' } });
```

O cliente já resolve sozinho:

- **Token:** põe `Authorization: Bearer ...` em toda chamada.
- **Idioma:** manda `Accept-Language`. Os **erros vêm traduzidos pela própria API**, então basta mostrar `error.message`.
- **Token vencido:** o access token dura 15 minutos. Num `401` de token vencido (`errors.http.401`), o cliente usa o
  refresh token, pega um par novo e repete a chamada uma vez, sem a pessoa perceber. Outros `401` (ex.: "entre de novo
  para fazer isto") voltam direto para a tela. Se várias chamadas recebem `401` juntas, elas esperam **uma única**
  renovação. Isso importa porque o refresh token é de uso único: dois refreshes em paralelo fariam a API achar que o
  token foi roubado e derrubar a sessão.
- **Sessão encerrada:** se o refresh for recusado (sessão revogada em outro dispositivo, senha trocada...), a sessão
  local é limpa e as rotas protegidas mandam para o `/login`.

### Onde os tokens ficam

| Token | Onde | Por quê |
| --- | --- | --- |
| Access token | Só na memória | Some ao fechar a aba; dura 15 minutos de qualquer forma |
| Refresh token | `localStorage` | Para a sessão sobreviver a um recarregamento da página |

O `localStorage` fica ao alcance de um script malicioso injetado na página (XSS). Por isso o front nunca renderiza HTML
vindo de fora (o React escapa tudo por padrão; não use `dangerouslySetInnerHTML` com dados da API), e a API detecta
reuso de refresh token e derruba a sessão.

### Erros

Todo erro da API tem o mesmo formato (`statusCode`, `code`, `message`, `errors?`, `requestId`). Com o `useAction`
(acima), o erro já chega pronto para mostrar:

```tsx
<Field label="E-mail" error={fieldError(error, 'email')} />  {/* erro do campo, embaixo dele */}
<FormError error={error} />                                  {/* erro geral (se não for de campo) */}
```

Falha de rede vira um erro com `code: 'network'` e texto próprio. O `account.reauthRequired` (conta sem senha com login
antigo) aparece com um botão "Entrar de novo".

Use o `code` (estável, em inglês) para decidir algo no código; use o `message` (traduzido) para mostrar.

## Receitas

### Nova tela

1. Crie o componente em `src/pages/`.
2. Adicione a rota em `src/App.tsx`. Se exige login, envolva com `<RequireAuth>`.
3. Textos novos vão em `src/i18n/messages.ts`, **nos dois idiomas**. O TypeScript acusa a chave que faltar.

### A API mudou

Quando uma rota ou DTO muda, a API regenera o `apps/api/openapi.json`. Depois, no front:

```bash
npm run api:types
```

```bash
npm run typecheck
```

O typecheck aponta exatamente onde o front precisa ser ajustado. O CI falha se o `schema.d.ts` commitado não bater
com o `openapi.json`.

### Novo idioma

1. Em `src/i18n/language.ts`, adicione o código em `LANGUAGES`.
2. Em `src/i18n/messages.ts`, copie o bloco `en`, traduza e registre em `MESSAGES`.
3. A API também precisa do idioma, para traduzir os erros e os e-mails (veja [GUIDES.md](GUIDES.md#novo-idioma)).

### Mostrar algo só para quem tem permissão

O usuário logado (`useAuth().user`) traz a lista `permissions`, calculada pela API a partir da role:

```tsx
const { user } = useAuth();
{can(user, 'users:read') && <Link to="/admin/users">Usuários</Link>}
```

Para uma tela inteira, envolva a rota em `App.tsx`:

```tsx
<Route path="/admin/reports" element={
  <RequirePermission permission="reports:read"><ReportsPage /></RequirePermission>
} />
```

E adicione o item no menu (`links` em [Layout.tsx](../apps/web/src/components/Layout.tsx)) com a mesma permissão.
Isso só **esconde**. Quem protege de verdade é a API, que confere a permissão em toda chamada.

## Testes

Veja [TESTING.md → Front](TESTING.md#front-appsweb).
