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
| `/` (sem login) | Página inicial | Apresenta o produto e leva a criar conta ou entrar. Logado, `/` é o Início do painel. Veja "Página inicial" abaixo |
| `/login` | Login | E-mail e senha, link por e-mail ("entrar sem senha") ou Google/Apple. Em dois passos quando a conta tem 2FA |
| `/register` | Cadastro | Também com Google/Apple |
| `/forgot-password` | Esqueci a senha | A API responde igual exista o e-mail ou não |
| `/reset-password?token=` | Nova senha | Link do "esqueci a senha" **e** do convite do admin ("crie sua senha") |
| `/verify-email?token=` | Confirmação de e-mail | Link do cadastro e da troca de e-mail; confirma sozinho ao abrir |
| `/magic-link?token=` | Entrar pelo link | Link do "entrar sem senha". Pede um clique em "Entrar" (filtros de e-mail abrem links e gastariam o de uso único). Com 2FA, segue para o código |
| `/create-password` | Crie sua senha | Exige login. Obrigatória para quem entrou pelo link sem ter senha nem Google/Apple (ex.: convidado) |
| `/privacy`, `/terms` | Política de Privacidade e Termos de Uso | Abrem com ou sem login. São os links pedidos pelo Google/Apple na tela de consentimento; o cadastro e o rodapé das telas públicas apontam para elas |

### Logadas (menu no topo)

| Rota | Tela | O que tem |
| --- | --- | --- |
| `/` | Início | Saudação, aviso de e-mail não confirmado (com "reenviar"), convite para ativar o 2FA, atalhos |
| `/account` | Minha conta | Foto (recorte quadrado no navegador e upload direto para o S3), nome e idioma, troca de e-mail (confirmada pelo endereço novo), troca de senha. Conta sem senha (só Google/Apple) recebe um link para criar uma |
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

As rotas que recebem links dos e-mails (`/login`, `/reset-password`, `/verify-email`, `/magic-link`, `/account/security`) precisam
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

## Página inicial

Quem abre `/` sem estar logado vê [LandingPage.tsx](../apps/web/src/pages/LandingPage.tsx) (o `RequireAuth` recebe
`publicHome`); quem está logado continua no Início. A ideia da página: as formas reais de entrar (senha, link,
Google, passkey, código) passam numa janela dentro do nome do produto. Seções: recursos com telas do painel,
"dê o seu nome" (o visitante digita um nome e vê o painel e o comando `new-project` mudarem), o deploy em quatro
etapas, números medidos no código e uma chamada que leva o e-mail para o cadastro.

- **Texto:** [landing/content.ts](../apps/web/src/landing/content.ts), em pt-BR e inglês. Num produto novo, troque o
  texto aqui; o layout não muda. Os números da seção "Medido no código" são reais: atualize quando mudarem.
- **Imagens:** `public/landing/<idioma>/` são telas do próprio painel tiradas da pré-visualização (`preview.html`,
  dados de exemplo), e `console.mp4` é uma gravação dela. Ao mudar o painel, capture de novo.
- **Movimento na rolagem:** [landing/scroll-motion.ts](../apps/web/src/landing/scroll-motion.ts), com GSAP + ScrollTrigger
  carregados só nesta página: a janela do título se abre ao rolar, as telas têm paralaxe, o deploy fica preso
  na tela passando pelas etapas (no desktop) e os números contam. Com "reduzir movimento" ligado, nada disso roda.
- **Visual:** [LandingPage.css](../apps/web/src/pages/LandingPage.css), só com os tokens do painel (fonte, cores e
  o tema escuro vêm de graça).

## Privacidade e Termos

As páginas `/privacy` e `/terms` vêm de [legal/content.ts](../apps/web/src/legal/content.ts), em pt-BR e inglês. O texto
descreve o que a base realmente faz: dados guardados, prazos (sessões 30 dias, auditoria 365, exclusão definitiva
30 dias após excluir a conta, logs 14), hospedagem na AWS nos EUA, cookie de sessão e preferências no navegador,
e onde a pessoa exerce os direitos da LGPD (baixar dados, excluir conta).

- **Responsável e contato:** `VITE_LEGAL_OWNER` (padrão: o nome do produto) e `VITE_SUPPORT_EMAIL`. No deploy vêm das
  variáveis `LEGAL_OWNER` e `SUPPORT_EMAIL` do GitHub. Em `LEGAL_OWNER`, use o nome da empresa (ou o seu) e, se houver,
  o CNPJ: ex. `Acme Ltda (CNPJ 00.000.000/0001-00)`.
- **Ao mudar o sistema** (novo dado, novo serviço de terceiros, outro prazo): atualize o texto e `LEGAL_UPDATED_AT`.
- É um ponto de partida, não um parecer jurídico: revise com quem cuida da parte legal do produto.

## Pré-visualização (sem API e sem login)

Para ajustar o visual ou ver uma tela de admin sem ter um admin, abra a pré-visualização com o `npm run dev` rodando.
Ela monta o app inteiro com dados de exemplo ([data.ts](../apps/web/src/preview/data.ts)) e uma API falsa no próprio
navegador. Nada é gravado e ela não entra no build.

| Endereço | O que mostra |
| --- | --- |
| `http://localhost:5173/preview.html?path=/admin/users` | Logado como admin, na lista de usuários |
| `...?path=/account&as=user` | Logado como usuário comum |
| `...?path=/login&as=anonymous` | Tela pública |
| `...&theme=light`, `&theme=dark`, `&lang=en` | Força o tema ou o idioma |

## Visual

O painel segue um estilo de console: a barra lateral e a superior formam uma moldura tingida, e a tela fica numa folha
branca. Ele usa uma fonte só (IBM Plex Sans, mais a Plex Mono para IDs e IPs). A cor da marca vai só nos dados e nas
marcações, e a ação principal de cada tela é o botão preto. Para adaptar à sua marca, mexa só nos tokens do começo do
[styles.css](../apps/web/src/styles.css):

| Token | Para quê |
| --- | --- |
| `--accent` | A cor da marca: marca do produto, barra de proteção, etiquetas de destaque |
| `--ground` | O tom da moldura (barra lateral e superior) |
| `--primary` | O botão principal (preto no claro, branco no escuro) |
| `--font`, `--mono` | As fontes (carregadas no `index.html`) |

O tema é **claro por padrão**. A pessoa troca para escuro ou "do sistema" no seletor ao lado do idioma (barra
superior e telas públicas), e a escolha fica salva no navegador ([theme.ts](../apps/web/src/lib/theme.ts)). Ela vira
`<html data-theme="light|dark">`; "do sistema" tira o atributo e o CSS segue o `prefers-color-scheme`. O site publica `favicon.svg` e `icon.png` (256 px, o ícone "de app"), em `apps/web/public/`. O `icon.png` também
aparece nos apps autenticadores que mostram ícone (veja [AUTH.md](AUTH.md#2fa-verificação-em-duas-etapas)): troque os
dois junto com a marca. A marca é o escudo com a
inicial ([Icon.tsx](../apps/web/src/components/Icon.tsx) → `ProductMark`): troque pelo logo do seu projeto.

Padrões das telas:
- **Configurações** (minha conta, segurança, privacidade e detalhe do usuário): uma linha por assunto. O nome e a
  explicação ficam à esquerda e o painel com os campos à direita (`<Section>`). Cada painel tem seus botões no pé, à
  direita, e a zona de exclusão vem sempre por último (`<Section danger>`).
- **Listas** (usuários e auditoria): abas, uma barra de filtros e a tabela direto na folha, sem cartão em volta.
- **Cor só no que pede atenção**: "e-mail não confirmado", "inativo", "alerta". O que está normal fica em cinza.
- **Botões só ativos quando faz sentido**: "Salvar" só acende quando algo mudou, e os botões de enviar (login, cadastro,
  senha, códigos) só com os campos obrigatórios preenchidos. Evita chamadas à API com formulário vazio; a validação
  de formato continua na API, com a mensagem embaixo do campo.
- **Confirmação só na hora de agir**: trocar o e-mail e excluir a conta mostram no painel só o essencial. A senha (e o
  código do 2FA) aparecem numa janela ao confirmar (`<ReauthDialog>` em [Reauth.tsx](../apps/web/src/components/Reauth.tsx)).
  Se a API recusar, o erro aparece na própria janela.

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
│   ├── ui.tsx              # PageHeader, Section, Field, SelectField, Modal, ConfirmDialog, Avatar, Badge, Pager...
│   ├── Icon.tsx            # ícones de contorno e a marca do produto
│   ├── Layout.tsx          # moldura das telas logadas (barra lateral, topo, folha) + RequirePermission
│   ├── RequireAuth.tsx     # protege rotas: sem sessão → /login (e volta depois)
│   ├── Reauth.tsx          # "confirme que é você" (senha e/ou código do 2FA)
│   └── SocialLogin.tsx     # botões do Google e da Apple
├── preview/                # pré-visualização com dados de exemplo (só em desenvolvimento)
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

Dados que várias telas usam ao mesmo tempo ficam num armazenamento compartilhado, buscados uma vez só. É o caso das
formas de login (`useLoginMethods`, em [login-methods.ts](../apps/web/src/auth/login-methods.ts)), que a moldura,
Segurança, Minha conta e a janela "confirme que é você" leem juntas. Depois de mudar algo, chame
`refreshLoginMethods()` e todas se atualizam.

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
| Refresh token | **Cookie `httpOnly`** gravado pela API | O JavaScript da página não consegue ler: um script malicioso injetado (XSS) não rouba a sessão para usar em outro lugar |
| Marcador `nb.session` | `localStorage` | Só diz "tem sessão" (nenhum segredo), para o site saber, ao abrir, se vale tentar renovar pelo cookie |

O front pede esse modo mandando `X-Session-Cookie: 1` em toda chamada, com `credentials: 'include'` (o cliente `api`
já faz isso). O cookie é `Secure` e `SameSite=Strict` e só vai para `/api/v1/auth`. Veja
[AUTH.md → Refresh token em cookie](AUTH.md#refresh-token-em-cookie-front-web).

Ainda assim, o front nunca renderiza HTML vindo de fora (o React escapa tudo por padrão; não use
`dangerouslySetInnerHTML` com dados da API): um script injetado continuaria podendo agir **dentro** da página enquanto
ela estiver aberta.

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

### Foto do perfil (recorte 1:1)

Ao escolher a foto, abre uma janela de recorte ([AvatarCropper.tsx](../apps/web/src/components/AvatarCropper.tsx)): arrastar
posiciona, o zoom aproxima (barra, rodinha do mouse ou `+`/`-`), as setas movem pelo teclado, e um círculo mostra como o
avatar vai ficar. O que sobe é o **recorte** redesenhado em 512×512 (JPEG): fica com poucos KB em vez de MB e **sem os
metadados** da original (EXIF, inclusive a localização GPS das fotos de celular). A original só precisa abrir no navegador
(até 20 MB); o limite de 2 MB do avatar vale para o recorte. As contas do recorte ficam em [crop.ts](../apps/web/src/lib/crop.ts),
com testes.

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

E adicione o item no menu (a lista `all` em [Layout.tsx](../apps/web/src/components/Layout.tsx), com um ícone do [Icon.tsx](../apps/web/src/components/Icon.tsx)) com a mesma permissão.
Isso só **esconde**. Quem protege de verdade é a API, que confere a permissão em toda chamada.

## Testes

Veja [TESTING.md → Front](TESTING.md#front-appsweb).
