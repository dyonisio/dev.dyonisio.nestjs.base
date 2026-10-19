# Cliente da API para o front

A API publica o próprio contrato no [`openapi.json`](../apps/api/openapi.json): todas as rotas, campos, tipos e erros.
Com ele, o front **gera** os tipos e as chamadas, em vez de escrever à mão. Se a API mudar um campo, o front deixa de
compilar exatamente onde precisa ser ajustado, antes de chegar ao usuário.

## Do lado da API (já pronto)

- `npm run openapi:export` gera o `openapi.json` sem banco nem servidor.
- O arquivo fica **commitado**: toda mudança de contrato aparece no diff do PR.
- O CI falha se ele estiver desatualizado. Mudou rota ou DTO? Rode o comando e commite.
- Com a API rodando, ele também está em `http://localhost:3000/docs-json` (Swagger ligado).

## Do lado do front (TypeScript)

> O front desta base ([`apps/web`](../apps/web)) já vem montado exatamente assim — veja [WEB.md](WEB.md).
> O passo a passo abaixo serve para outro front (outro repositório, app mobile em React Native...).

Com [openapi-typescript](https://openapi-ts.dev) + [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) (leves, sem gerar classes).
Instale no projeto do front:

```bash
npm i openapi-fetch
```

```bash
npm i -D openapi-typescript
```

Gere os tipos (copie o `openapi.json` da API para o front ou aponte para o repositório/URL):

```bash
npx openapi-typescript ../minha-api/openapi.json -o src/api/schema.d.ts
```

Crie o cliente (`src/api/client.ts`):

```ts
import createClient from 'openapi-fetch';
import type { paths } from './schema';

export const api = createClient<paths>({ baseUrl: import.meta.env.VITE_API_URL });

// Token e idioma em todas as chamadas
api.use({
  onRequest({ request }) {
    const token = localStorage.getItem('accessToken');
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    request.headers.set('Accept-Language', navigator.language);
    return request;
  },
});
```

Use com autocomplete e checagem de tipos:

```ts
const { data, error } = await api.GET('/api/v1/users/me');
if (error) showError(error.message);   // erro já traduzido; use error.code para decidir o que fazer
data?.permissions.includes('users:read'); // mostrar/esconder o menu de admin

await api.POST('/api/v1/auth/login', { body: { email, password } });
// body com campo errado ou faltando → erro de compilação
```

Adicione um script no front para regenerar quando a API mudar:

```json
"scripts": { "api:types": "openapi-typescript ../minha-api/openapi.json -o src/api/schema.d.ts" }
```

## Outros geradores

| Gerador | Quando usar |
| --- | --- |
| [orval](https://orval.dev) | React Query / SWR / Vue Query: gera os hooks prontos |
| [openapi-generator](https://openapi-generator.tech) | Apps mobile (Kotlin, Swift, Dart/Flutter) ou outras linguagens |

## Coisas que o front precisa tratar

| Situação | Como reconhecer | O que fazer |
| --- | --- | --- |
| Access token expirou | 401 em rota autenticada | `POST /auth/refresh` com o refresh token e repetir a chamada. Se o refresh também der 401, mandar para o login. No navegador, prefira o modo cookie ([AUTH.md](AUTH.md#refresh-token-em-cookie-front-web)): o refresh token fica num cookie `httpOnly` |
| Login com 2FA | resposta tem `twoFactorRequired: true` | Pedir o código e chamar `/auth/2fa/verify` |
| E-mail não confirmado | 403 `auth.emailNotVerified` | Tela "confirme seu e-mail" com botão de reenviar |
| Ação sensível sem senha recente | 401 `account.reauthRequired` | Pedir para entrar de novo (contas só com Google/Apple) |
| Muitas tentativas | 429 `errors.tooManyRequests` | Mostrar a mensagem (já diz quantos segundos esperar) |
| Erros de formulário | 400 `errors.validation` | `errors[]` traz `field` e `message` por campo |
