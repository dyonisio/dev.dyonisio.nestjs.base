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

| Rota | Tela | Observação |
| --- | --- | --- |
| `/login` | Login | Em dois passos quando a conta tem 2FA (código do app ou de recuperação) |
| `/register` | Cadastro | |
| `/forgot-password` | Esqueci a senha | A API responde igual exista o e-mail ou não |
| `/reset-password?token=` | Nova senha | Link do "esqueci a senha" **e** do convite do admin ("crie sua senha") |
| `/verify-email?token=` | Confirmação de e-mail | Link do cadastro e da troca de e-mail; confirma sozinho ao abrir |
| `/` | Início | Exige login. Avisa se o e-mail ainda não foi confirmado (com "reenviar") |
| `/account/security` | Segurança da conta | Exige login (em construção: sessões, 2FA, login social) |

As rotas dos links de e-mail (`/reset-password`, `/verify-email`) precisam ter exatamente esses nomes: é a API que
monta os links, com o `FRONTEND_URL` na frente.

## Como está organizado

```
src/
├── main.tsx                # monta o app: roteador, idioma e sessão
├── App.tsx                 # a lista de rotas
├── config.ts               # VITE_API_URL
├── api/
│   ├── schema.d.ts         # GERADO do apps/api/openapi.json (npm run api:types) — não edite
│   └── client.ts           # o cliente `api` (token, idioma, refresh automático)
├── auth/
│   ├── session.ts          # onde os tokens ficam
│   └── AuthProvider.tsx    # useAuth(): login, 2FA, cadastro, logout, usuário atual
├── i18n/                   # textos da interface e idioma atual
├── components/
│   ├── ui.tsx              # AuthCard, Field, ErrorAlert, SuccessAlert, LanguageSwitch...
│   └── RequireAuth.tsx     # protege rotas: sem sessão → /login (e volta depois)
├── pages/                  # as telas
└── styles.css              # tema (cores em variáveis CSS, claro/escuro automático)
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
- **Token vencido:** o access token dura 15 minutos. Num `401`, o cliente usa o refresh token, pega um par novo e repete
  a chamada uma vez, sem a pessoa perceber. Se várias chamadas recebem `401` juntas, elas esperam **uma única**
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

Todo erro da API tem o mesmo formato (`statusCode`, `code`, `message`, `errors?`, `requestId`). Nas telas:

```tsx
const [error, setError] = useState<ApiError | null>(null);
// ...
try {
  const { error: apiError } = await api.POST('/api/v1/auth/password/forgot', { body: { email } });
  if (apiError) throw apiError;
} catch (e) {
  setError(toApiError(e)); // erro da API ou falha de rede, no mesmo formato
}
// ...
<Field label="E-mail" error={fieldError(error, 'email')} />   {/* erro do campo, embaixo dele */}
<ErrorAlert error={error?.errors ? null : error} />            {/* erro geral, no topo */}
```

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
{user?.permissions.includes('users:read') && <Link to="/admin/users">Usuários</Link>}
```

Isso só **esconde** o botão. Quem protege de verdade é a API, que confere a permissão em toda chamada.

## Testes

Veja [TESTING.md → Front](TESTING.md#front-appsweb).
