---
name: web-app
description: Como o front React deste repositório (apps/web) é organizado e como mexer nele — telas, rotas, componentes de UI, chamadas tipadas à API, textos em português e inglês, permissões, pré-visualização com dados falsos, página inicial animada e testes com Vitest. Use antes de editar qualquer arquivo em apps/web.
---

# Front (`apps/web`)

Guia longo: `docs/WEB.md` (telas, visual, receitas) e `docs/API_CLIENT.md`.

## Mapa

| Onde | O quê |
| --- | --- |
| `src/App.tsx` | Rotas. Telas logadas dentro do layout; admin envolvido em `<RequirePermission permission="...">` |
| `src/components/Layout.tsx` | Menu lateral (itens com `permission` somem sem ela) |
| `src/components/ui.tsx` | `PageHeader`, `Section` (título+ajuda à esquerda, painel à direita), `Field`, `SelectField`, `Checkbox`, `Modal`, `ConfirmDialog`, `Badge`, `ErrorAlert`, `FormError`, `SuccessAlert`, `fieldError`, `Pager`, `Avatar` |
| `src/components/Icon.tsx` | Ícones (caminhos SVG em `PATHS`) |
| `src/lib/hooks.ts` | `useQuery(fn, deps)` → `{ data, loading, error, reload, setData }`; `useAction()` → `{ run, busy, error, setError }` |
| `src/lib/format.ts` | `formatDate`, `formatDateTime`, `formatMoney(lang, cents, currency)`, ... |
| `src/lib/external.ts` | `goToExternal(url)` (sair do site; mockado nos testes) |
| `src/api/schema.d.ts` | **Gerado** (`npm run api:types`) do `apps/api/openapi.json`. Não edite |
| `src/auth/permissions.ts` | `can(user, 'perm')` só esconde; quem protege é a API |
| `src/i18n/messages.ts` | Todos os textos, `en` e `ptBR` |
| `src/preview/` | Pré-visualização sem API (`data.ts` + `mock-api.ts`) |
| `src/pages/account/`, `pages/admin/` | Telas da pessoa e do admin |
| `src/landing/`, `pages/LandingPage.tsx` | Página inicial pública (lazy), Motion + GSAP ScrollTrigger |

## Padrões

```tsx
const q = useQuery(() => api.GET('/api/v1/users/{id}/billing', { params: { path: { id } } }), [id]);
const { run, busy, error } = useAction();
const save = () => void run(async () => {
  const { data, error: apiError } = await api.POST('/api/v1/...', { body });
  if (apiError || !data) throw apiError;
  q.setData(data); // ou q.reload()
});
```
- Tipos vêm do schema: `type X = components['schemas']['XDto']`.
- Ação destrutiva: `ConfirmDialog` (ou `Modal` com botão `className="danger"`); avisos com `SuccessAlert`.
- Linhas de lista: `<ul className="rows"><li><div className="row-main"><span className="row-title">` +
  `row-meta`; botões em `row-actions`. Valores em `tabular`.

## Textos (i18n)

- `messages.ts`: objeto `en` define o formato; `ptBR: Dict` precisa ter **as mesmas chaves** (o typecheck falha).
  Bloco novo: acrescente nos dois. Interpolação com `f(m.x.y, { name })` e `{name}` no texto.
- `useI18n()` → `{ m, f, lang }`. Ações de auditoria novas da API precisam de entrada em `auditActions` nos dois.
- Testes rodam em inglês (`renderApp` força `en`): procure pelos textos em inglês.

## API mudou

`cd apps/api && npm run openapi:export`, depois `cd apps/web && npm run api:types && npm run typecheck`.

## Permissão nova

Lista `ALL` em `src/preview/data.ts` **e** `src/test/render.tsx` (o admin falso tem todas). Menu: item com
`permission` em `Layout.tsx`; rota com `RequirePermission`; bloco dentro de tela com `can(me, '...') && ...`.

## Pré-visualização (sem API, sem login)

`http://localhost:5173/preview.html?path=/admin/users` (`&as=user|anonymous`, `&theme=dark`, `&lang=en`).
Rota nova usada por uma tela: responda em `src/preview/mock-api.ts` (dados em `data.ts`, tipados pelo schema).
Rotas com id: regex sobre `route`/`path`, antes do `const one = path.match(...)` de usuário.

## Testes (Vitest + Testing Library)

- `renderApp(path, makeUser({ role: 'admin' }), { 'GET /api/v1/...': () => json(200, body) })` abre o app logado;
  `lastBody(fetch, 'POST', '/api/v1/...')` lê o corpo enviado. `src/test/fetch-mock.ts` tem `json()` e `requestOf()`.
- Várias seções iguais na tela: `within(heading.closest('section')!)`.
- `IntersectionObserver` e `matchMedia` não existem no jsdom: o stub está em `src/test/setup.ts`; código com GSAP
  só roda se `typeof window.matchMedia === 'function'` (senão vira erro não tratado no CI).
- Lazy load da landing é lento no CI: `findBy...` com `{ timeout: 5000 }`.

## Fechar

`npm run format && npm run lint && npm run typecheck && npx vitest run && npm run build`.
Para olhar a tela de verdade: `npm run dev` + pré-visualização (o painel do navegador escondido pausa animações).
