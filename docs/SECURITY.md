# Segurança

> Os comandos `npm` e os caminhos deste guia (`.env`, `serverless.yml`, `src/...`) são da API: rode-os em `apps/api`.

O que a base faz para resistir a invasões, o que **você** precisa configurar e as decisões tomadas de propósito.
A base passou por uma auditoria de segurança (injeção, autenticação, autorização, uploads, configuração e dependências),
e os pontos encontrados foram corrigidos e cobertos por testes.

## Proteções por tipo de ataque

### Injeção

| Ataque | Defesa |
| --- | --- |
| **SQL injection** | Todo acesso ao banco usa parâmetros (TypeORM / `$1`). Nenhum SQL é montado com texto do usuário. Na busca, `%` e `_` são escapados e o campo de ordenação vem de uma lista fixa |
| **Campos extras / mass assignment** | `ValidationPipe` com `whitelist` + `forbidNonWhitelisted`: campo não declarado no DTO = 400. Ninguém se cadastra como `admin` nem muda o próprio `isActive` |
| **Template injection / XSS em e-mails** | Handlebars com escape em todo dado (`{{ }}`). Nome de pessoa só aceita letras, espaço, apóstrofo, hífen e ponto de abreviação: sem números, `<>`, `://` ou "site.com", então não vira link de phishing no e-mail |
| **Header injection em e-mails** | Destinatário validado como e-mail. Assuntos vêm das traduções, nunca do usuário |
| **Path traversal** | O caminho do arquivo é gerado pelo servidor. O driver local normaliza e barra `../`, inclusive o truque `public/../private/...` |
| **Prototype pollution** | `class-transformer` com proteção a `__proto__`. Nenhum `Object.assign` com objeto do usuário sem passar pelo DTO |
| **ReDoS** | Regexes de validação lineares. Todo texto livre tem tamanho máximo (`IsBoundedString`); corpo da requisição limitado a 100 kB |
| **SSRF** | Nenhuma requisição de saída usa URL do usuário. As chaves do Google/Apple vêm de URLs fixas |

### Autenticação e contas

| Ataque | Defesa |
| --- | --- |
| **Força bruta de senha** | Limite por IP (20/15 min) **e** por e-mail (5/15 min) no login. bcrypt custo 12 |
| **Descobrir e-mails cadastrados** | Login com tempo constante (bcrypt roda mesmo sem o usuário), mesma mensagem para e-mail ou senha errados, "esqueci a senha" sempre responde 200 |
| **Token roubado (XSS, celular)** | Access token de 15 min. Sessões revogáveis na hora. Ações sensíveis (trocar e-mail, excluir conta, ativar 2FA) **pedem a senha** (e o código 2FA) |
| **Refresh token roubado** | Uso único com rotação. Se um token já usado reaparecer, a sessão é derrubada. Guardados só como hash SHA-256 |
| **Sequestro pela troca de e-mail** | O e-mail só muda depois que o endereço **novo** confirma, e o antigo é avisado |
| **Pré-sequestro** (cadastrar o e-mail da vítima antes dela) | Quando o dono real entra com Google/Apple, a conta não confirmada é assumida e a senha, o 2FA e as sessões de quem a criou são descartados |
| **Login social forjado** | Assinatura, emissor, audiência (só os **seus** client IDs), validade, algoritmo (RS256) e nonce conferidos. Só vincula por e-mail confirmado pelo provedor |
| **Força bruta / replay de 2FA** | 10 tentativas/15 min por usuário. Código já usado não vale de novo, nem em requisições simultâneas (update atômico). Segredo cifrado (AES-256-GCM) |
| **Confusão de tokens** | Cada tipo de token (acesso, confirmar e-mail, redefinir senha, desafio 2FA, upload local) tem **segredo próprio** derivado por HKDF e campo `purpose`. Algoritmo fixo em HS256: tokens com outro `alg` (inclusive `none`) são recusados |
| **Link de redefinição reutilizado** | O segredo do link depende do hash da senha atual: depois de usado, deixa de valer |
| **Sessão eterna** | Idade máxima de 90 dias, mesmo com uso diário |
| **Ação sem o dono saber** | E-mails de alerta: dispositivo novo, senha, e-mail, 2FA, login social vinculado, exclusão |

### Autorização

| Risco | Defesa |
| --- | --- |
| **Esquecer de proteger uma rota** | Guards **globais**: toda rota exige login, e-mail confirmado e (se declarado) permissão. Abrir algo exige `@Public()` explícito |
| **Acessar dado de outro usuário (IDOR)** | Consultas de "meus dados" sempre filtram pelo dono e respondem 404 (sem revelar que existe) |
| **Escalar privilégio** | Role lida do banco a cada requisição. Ninguém muda a própria role nem se exclui pelo admin. O último admin não pode excluir a própria conta |

### Uploads

O tipo é declarado e conferido pelos *magic bytes* (SVG e HTML não são aceitos), o tamanho é travado na assinatura do S3 e conferido
depois, e há cota de uploads em aberto por usuário. `public/` e `private/` ficam separados (privado só por link assinado de 5 min).
A rota de upload local (dev) é bloqueada **antes** de ler o corpo quando o driver é o S3.

### Infraestrutura e configuração

- **Headers HTTP:** helmet (HSTS, nosniff, frameguard, CSP). CORS só para as origens configuradas.
- **TLS com o banco conferido** (`DB_SSL=true` + CA da AWS). Sem isso, alguém no caminho da rede poderia se passar pelo banco.
- **Configuração validada no boot.** Em produção a API **não sobe** se:
  - faltar `DB_*`, `FRONTEND_URL`, `CORS_ORIGIN`, `MAIL_*` ou `ENCRYPTION_KEY`;
  - `CORS_ORIGIN=*`, ou `FRONTEND_URL`/`APP_URL` apontarem para localhost;
  - `JWT_SECRET`/`ENCRYPTION_KEY` forem curtos, de exemplo ou iguais entre si;
  - `DB_SYNCHRONIZE=true`, o banco for em memória ou o storage for local;
  - fora da Lambda, faltar `TRUST_PROXY`.
- **Avisos no log** (não impedem de subir): rate limit ou confirmação de e-mail desligados, banco sem TLS, Swagger público.
- **Segredos fora do código:** SSM na AWS. `.env` fora do Git e da imagem Docker. Seed sem senha padrão.
- **Logs sem dados sensíveis:** headers, corpos e e-mails completos não são logados.
- **Container:** usuário sem privilégios, imagem mínima, sem dependências de desenvolvimento.
- **AWS:** IAM com o mínimo (fila, bucket e identidades SES específicas), bucket com leitura pública só em `public/`.
- **Dependências:** `npm audit` no CI (falha com vulnerabilidade alta em dependência de produção) e Dependabot semanal.

## Checklist de produção

- [ ] `JWT_SECRET` e `ENCRYPTION_KEY` gerados com `openssl rand -base64 48`, **diferentes**, guardados no SSM
- [ ] `FRONTEND_URL`, `CORS_ORIGIN`, `MAIL_FROM`, `MAIL_SUPPORT_EMAIL` com os valores reais
- [ ] SES: domínio verificado (com DKIM) e fora do sandbox
- [ ] Banco em subnet privada, `DB_SSL=true`, certificado conferido (Lambda: automático; ECS: `DB_SSL_CA_FILE`)
- [ ] `TRUST_PROXY` correto (0 na Lambda, 1 atrás de ALB)
- [ ] `npm run seed` com `ADMIN_PASSWORD` forte (ou a gerada), e o admin ativa o **2FA**
- [ ] `alarmEmail` configurado e a inscrição confirmada no e-mail
- [ ] Swagger desligado em produção (padrão), ou protegido
- [ ] Throttling do API Gateway e/ou AWS WAF contra volume alto
- [ ] Branch protection no GitHub exigindo o CI verde
- [ ] Dependabot ligado e PRs de segurança revisados

## Decisões conscientes (trade-offs)

Pontos em que a base escolheu simplicidade ou usabilidade. Mude se o seu caso exigir:

| Decisão | Risco | Alternativa |
| --- | --- | --- |
| O cadastro responde **409** para e-mail já cadastrado | Revela que o e-mail tem conta | Responder 201 genérico e mandar e-mail ao dono (mas sem login automático no cadastro) |
| O limite por e-mail no login (5/15 min) vale de **qualquer IP** | Alguém pode travar o login de outra pessoa por 15 min | Limitar por e-mail+IP, ou usar CAPTCHA após N erros |
| `nonce` no login social é **opcional** | Um ID token vazado poderia ser reusado durante a validade (minutos) | Tornar obrigatório em `oidc-verifier.service.ts` (o front gera e envia) |
| A sessão é conferida no banco **a cada requisição** | 1 consulta extra por chamada | JWT sem consulta + lista de revogados (perde a revogação imediata) |
| `MAIL_DELIVERY=sync` em dev | O tempo de resposta do "esqueci a senha" varia | Em produção já é `sqs` (tempo constante) |

## Reportar uma vulnerabilidade

Não abra issue pública. Envie para o e-mail de segurança do projeto (defina em `MAIL_SUPPORT_EMAIL` ou num `SECURITY.md`
na raiz) com os passos para reproduzir. Responda em até 72 h e corrija antes de divulgar.
