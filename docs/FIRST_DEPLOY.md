# Primeiro deploy na AWS, passo a passo

Guia para quem nunca publicou na AWS. Segue a ordem certa, explica **o porquê** de cada passo e termina com os
erros mais comuns e como resolver. Tudo pelo console da AWS (o site), sem precisar instalar a AWS CLI.

> Os comandos `npm` e os caminhos deste guia (`.env`, `serverless.yml`, `src/...`) são da API: rode-os em `apps/api`.

Depois de pronto, os próximos deploys são **um botão no GitHub**. Os detalhes técnicos de cada peça estão em
[DEPLOY_AWS_LAMBDA.md](DEPLOY_AWS_LAMBDA.md).

---

## 0. Antes de começar

### O que o deploy cria sozinho e o que você cria

O deploy (`serverless deploy`, rodado pelo GitHub Actions) cria e atualiza **toda a infraestrutura da aplicação**:
as funções Lambda (`api`, `mailWorker`, `maintenance`), o API Gateway (a URL pública), as filas de e-mail, o bucket de
uploads, os alarmes e as permissões delas.

Você cria **uma vez**, à mão, o que guarda dados ou segredos (e por isso não pode ser apagado junto com um deploy):

| Passo | O quê | Por que não é automático |
| --- | --- | --- |
| 1 | Banco de dados (RDS Postgres) | Guarda os dados. Se fosse do deploy, um `serverless remove` apagaria tudo |
| 2 | Segredos no SSM | Não podem ficar no código nem no GitHub |
| 3 | Domínio de e-mail no SES | Exige provar que o domínio é seu (DNS) e uma aprovação da AWS |
| 4 | Acesso do GitHub à AWS | É a própria permissão do deploy — ele não pode criá-la para si |
| 5 | Tabelas e administrador inicial | O deploy não mexe no banco de propósito |
| 6 | O deploy | Um botão no GitHub |

### Escolha UMA região e use em tudo

A AWS é dividida em regiões (ex.: `us-east-1` Virgínia, `us-east-2` Ohio, `sa-east-1` São Paulo). **Banco, segredos, SES e o
deploy precisam estar na mesma região** — o deploy procura os segredos e o domínio de e-mail na região em que roda.

- A região aparece no canto superior direito do console. **Confira sempre antes de criar qualquer coisa.**
- No GitHub, a região do deploy é a variável `AWS_REGION` do environment (padrão `us-east-1`).

### Custo

A Lambda é quase de graça com pouco tráfego. O **RDS cobra 24 h por dia**, mesmo parado (a menor instância ~US$ 15–20/mês).
Para começar barato: um Postgres gerenciado com plano gratuito (Neon, Supabase) funciona igual — basta pôr os dados
de conexão no SSM (passo 2).

---

## 1. Banco de dados (RDS Postgres)

1. **RDS → Create database** → *Standard create* → **PostgreSQL** (versão 16 ou mais nova).
2. *Templates*: **Free tier** (se disponível) ou **Production**.
3. *Settings*: anote o **Master username** (ex.: `postgres`) e crie uma **senha forte**. Não cole a senha em chats, e-mails ou arquivos — ela vai direto para o SSM (passo 2).
4. *Connectivity*: veja a decisão abaixo (público ou privado).
5. *Additional configuration* → **Initial database name**: `nestjs_base`. (Se esquecer, dá para criar depois — passo 5.)
6. **Create database** e espere o status **Available** (~10 min).

### Público ou privado?

Do jeito que o `serverless.yml` vem, a Lambda **não** fica dentro de uma rede privada (VPC) — então ela só alcança um banco **público**.

| | A: banco público (simples e barato para começar) | B: banco privado (ideal em produção) |
| --- | --- | --- |
| Como | *Public access* = **Yes** | Banco em subnet privada + descomentar `vpc:` no `serverless.yml` |
| Liberação | No *security group* do RDS, porta 5432 para `0.0.0.0/0` (a Lambda não tem IP fixo) | Só a Lambda enxerga o banco |
| Custo extra | nenhum | NAT Gateway (~US$ 32/mês) ou VPC endpoints para SQS/SES/S3 |
| Proteção | Senha forte + TLS obrigatório (abaixo) | Banco invisível de fora |

Para começar, a A é razoável. Quando houver usuários reais, migre para a B.

### TLS obrigatório (criptografia na conexão)

**PostgreSQL 15 ou mais novo já vem com TLS obrigatório** (`rds.force_ssl = 1`) — confira em *Databases → seu banco → Configuration → Engine version* e pule esta parte.

Versão 14 ou anterior:

1. **RDS → Parameter groups → Create parameter group**: *Engine type* PostgreSQL, *family* igual à versão do banco
   (ex.: `postgres14`), *Type* **DB Parameter Group** (ou *DB Cluster Parameter Group* se for Aurora), nome `nestjs-base-api-postgres`.
2. Abra o grupo → **Edit** → busque `rds.force_ssl` → valor **`1`** → **Save changes**.
3. **Databases → seu banco → Modify → Additional configuration → DB parameter group** → escolha o grupo → **Continue** →
   **Apply immediately** → **Modify DB instance**.
4. **Actions → Reboot** (obrigatório para valer; o banco fica fora 1–3 min).
5. Confira em *Configuration*: o parameter group deve aparecer **In sync**.

A API já conecta com TLS e **confere o certificado** do RDS — ninguém no caminho da rede consegue se passar pelo banco.

---

## 2. Segredos no SSM Parameter Store

O SSM é o "cofre" da AWS. O deploy lê os segredos de lá e os entrega à Lambda — nunca ficam no código nem no GitHub.

São 6, com o nome `/nestjs-base-api/<stage>/<NOME>` (`<stage>` = `dev` ou `prod`):

| Nome | Valor |
| --- | --- |
| `DB_HOST` | o **Endpoint** do RDS (aba *Connectivity & security*), ex.: `meu-db.abc123.us-east-2.rds.amazonaws.com` |
| `DB_NAME` | `nestjs_base` |
| `DB_USERNAME` | o usuário mestre (ex.: `postgres`) |
| `DB_PASSWORD` | a senha do banco |
| `JWT_SECRET` | gerado (abaixo) |
| `ENCRYPTION_KEY` | gerado (abaixo), **diferente** do `JWT_SECRET` |

> O prefixo `nestjs-base-api` é o `service` do `serverless.yml`. Se renomear o projeto, os nomes mudam junto.

Gere os dois segredos (rode **duas vezes**, um valor para cada — funciona no Git Bash):

```bash
openssl rand -base64 48
```

Criar cada um:

1. Console → **Systems Manager → Parameter Store → Create parameter** (confira a **região**).
2. **Name:** ex. `/nestjs-base-api/prod/DB_PASSWORD` — com a barra no início, exatamente assim.
3. **Tier:** Standard (grátis) · **Type:** **SecureString** · **KMS key:** a padrão (`alias/aws/ssm`).
4. **Value:** cole o valor → **Create parameter**. Repita para os 6.

Cuidados:

- Use **SecureString** (cifrado). `String` funciona, mas guarda em texto puro. O tipo não pode ser trocado depois:
  para corrigir, copie o valor, apague e crie de novo com o mesmo nome.
- **Nunca troque o `ENCRYPTION_KEY`** depois que houver usuários com 2FA — eles deixariam de conseguir entrar.
- Trocou algum valor? Ele só chega à Lambda no **próximo deploy** (o deploy copia os valores).
- `prod` e `dev` com valores **diferentes**, principalmente os dois segredos gerados.

---

## 3. E-mails: Amazon SES

O SES envia os e-mails da API (confirmação de cadastro, senha, alertas). A AWS exige **provar que o domínio é seu** e
**pedir liberação** para enviar a qualquer pessoa. Você precisa de um domínio (ex.: `seudominio.com.br`) com acesso ao DNS.

### 3.1 Verificar o domínio (15 min + espera do DNS)

1. **Amazon SES → Identities → Create identity** → **Domain** → `seudominio.com.br`.
2. Deixe ligado **Easy DKIM** (RSA 2048) → **Create identity**.
3. A AWS mostra **3 registros CNAME**: crie os três no painel de DNS do domínio (Registro.br, Cloudflare...), copiando nome e valor exatos.
4. Espere o status **Verified** (minutos a horas).

DKIM é uma "assinatura" que prova aos destinatários (Gmail, Outlook) que o e-mail veio de você — sem ela, vai para o spam.

### 3.2 DMARC (recomendado)

Registro **TXT** no DNS do domínio:

| Campo | Valor |
| --- | --- |
| Tipo | `TXT` |
| Nome / Host | `_dmarc` (se o painel pedir o nome completo: `_dmarc.seudominio.com.br`) |
| Valor | `v=DMARC1; p=none; rua=mailto:voce@seudominio.com.br` |

- **Registro.br:** Domínios → o domínio → Editar zona → Nova entrada.
- **Cloudflare:** DNS → Records → Add record.
- **Route 53:** Hosted zones → Create record (valor **entre aspas**).

Conferir (depois de alguns minutos):

```powershell
nslookup -type=TXT _dmarc.seudominio.com.br
```

`p=none` só monitora (você recebe relatórios de quem envia em nome do domínio). Depois de algumas semanas, passe para
`p=quarantine` e então `p=reject` — protege o domínio contra phishing.

### 3.3 Sair do sandbox

Contas novas só enviam para e-mails verificados (máx. 200/dia). **SES → Account dashboard → Request production access**:

- **Mail type:** *Transactional*.
- Respostas prontas em inglês para o formulário (e para as perguntas que a AWS costuma mandar depois) — troque o que está entre colchetes:

> **Use case:** We only send transactional emails triggered by a user's own action or by a security event on their account:
> email address confirmation (sign-up and email change), password reset requests, security alerts (new sign-in from an
> unrecognized device, password changed, two-factor authentication enabled or disabled, account deleted) and account
> notifications. We do not send marketing, newsletters or promotional emails.
>
> **Mailing list:** We do not use mailing lists and never buy or import addresses. We only email users who create an account
> themselves, and every address must be confirmed through a verification link (double opt-in).
>
> **Bounces and complaints:** We use the SES account-level suppression list, so addresses that hard bounce or complain are
> automatically blocked. Emails go through an SQS queue with a dead-letter queue and a CloudWatch alarm, so delivery failures
> are visible to our team immediately. We monitor bounce and complaint rates in the SES reputation dashboard.
>
> **Opt-out:** Our emails are transactional and required for account security, sent only to the account owner. Users can
> delete their account at any time in the application settings; personal data is permanently erased after 30 days.
>
> **Volume:** about [100] emails per day at launch, growing to [1,000] per day, proportional to user activity.
>
> **Sending domain:** no-reply@[seudominio.com.br], verified in SES with Easy DKIM and DMARC published.

Confira em **SES → Configuration → Suppression list** que a lista está ligada para *bounces* e *complaints* (já vem
ligada em contas novas). A resposta da AWS costuma vir em horas; enquanto isso, siga os outros passos.

---

## 4. Dar ao GitHub acesso à AWS (OIDC)

Em vez de guardar uma chave da AWS no GitHub (que poderia vazar), a AWS **confia no GitHub** para pedir uma credencial
temporária, só durante o deploy e só para o seu repositório.

### 4.1 Registrar o GitHub (1 vez por conta AWS)

**IAM → Identity providers → Add provider** → *OpenID Connect*:

- **Provider URL:** `https://token.actions.githubusercontent.com`
- **Audience:** `sts.amazonaws.com`

### 4.2 Política de permissões do deploy

**IAM → Policies → Create policy → aba JSON** → cole [docs/aws/github-deploy-policy.json](aws/github-deploy-policy.json)
→ nome `nestjs-base-api-deploy` → **Create policy**.

Ela só permite mexer em recursos cujo nome começa com `nestjs-base-api-`. Mesmo que o workflow fosse adulterado, não
conseguiria apagar outras coisas da conta.

> O editor do console às vezes marca ações válidas como "não existe" (ex.: `apigateway:TagResource`). Por isso a política
> usa `apigateway:*` — o escopo continua limitado por recurso.

### 4.3 A role que o GitHub assume

1. **IAM → Roles → Create role** → **Custom trust policy**.
2. Cole [docs/aws/github-trust-policy.json](aws/github-trust-policy.json) e troque:
   - `SEU_ACCOUNT_ID` pelo número da sua conta (12 dígitos, canto superior direito do console);
   - o dono e o repositório pelos seus;
   - os **números** (`@62189506`, `@1420175707`) pelos do seu dono/repositório — veja abaixo como descobrir.
3. **Next** → marque a política `nestjs-base-api-deploy` → nome `github-deploy-nestjs-base-api` → **Create role**.
4. Abra a role e **copie o ARN** (`arn:aws:iam::123456789012:role/github-deploy-nestjs-base-api`).

**Sobre o `sub` (quem é o GitHub):** o GitHub se identifica como `repo:dono@ID/repositorio@ID:environment:prod` (formato
novo, com os IDs numéricos — mais seguro: um repositório recriado com o mesmo nome tem outro ID) ou
`repo:dono/repositorio:environment:prod` (antigo). O modelo aceita os dois. Para descobrir os seus números, rode o deploy
uma vez: a etapa **"Diagnóstico do login na AWS"** mostra o `sub` exato.

### 4.4 Environments no GitHub

Repositório → **Settings → Environments → New environment** → `prod` (e/ou `dev`). Em **Environment variables**
(*variables*, não *secrets* — nada aqui é segredo; os segredos estão no SSM):

| Variável | Obrigatória | Valor |
| --- | --- | --- |
| `AWS_ROLE_ARN` | sim | o ARN do 4.3 |
| `AWS_REGION` | se não for `us-east-1` | a região escolhida (ex.: `us-east-2`) |
| `FRONTEND_URL` | sim | URL do seu front (ex.: `https://app.seudominio.com.br`) |
| `MAIL_FROM` | sim | `Minha App <no-reply@seudominio.com.br>` (domínio verificado no SES) |
| `SUPPORT_EMAIL` | sim | e-mail de suporte |
| `ALARM_EMAIL` | não | quem recebe os alarmes |
| `CORS_ORIGIN` | não | origens do front que chamam a API e enviam arquivos **pelo navegador**, separadas por vírgula e sem espaços (ex.: `https://app.seudominio.com.br,http://localhost:3000`). Padrão: `FRONTEND_URL` |
| `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` | não | login social |
| `SWAGGER_ENABLED` | não | `true` para manter a documentação (`/docs`) ligada neste environment. Padrão: ligada só no stage `dev` |

No `prod`, marque **Required reviewers** com o seu usuário: todo deploy em produção espera a sua aprovação.

---

## 5. Criar as tabelas e o administrador

> **As tabelas são criadas pelo próprio deploy** (a Lambda `migrate`, no passo 6), e os deploys seguintes aplicam as
> migrations novas sozinhos. Do seu computador, só falta criar o **administrador inicial** (5.5, o `npm run seed`). O
> `npm run migration:run` abaixo continua valendo para rodar à mão, se precisar.

Feito do seu computador, apontando para o banco da AWS. Use o **PowerShell** (VS Code: *Terminal → New Terminal*, ou
botão direito na pasta do projeto → *Abrir no Terminal*). **Faça tudo no mesmo terminal**: as variáveis do passo 5.3
só existem nele, de propósito (a senha some quando você fecha).

### 5.0 Ajuste o seu `.env`

Deixe `ADMIN_PASSWORD=` **vazio**. O seed recusa senhas de exemplo (`Admin@123456`) e, vazio, gera uma senha forte.

### 5.1 Libere seu IP e teste a rede

No *security group* do RDS, regra de entrada `PostgreSQL / 5432 / My IP` (se já liberou `0.0.0.0/0`, pule). Teste:

```powershell
Test-NetConnection SEU-ENDPOINT.rds.amazonaws.com -Port 5432
```

`TcpTestSucceeded : True` → siga. `False` → confira *Public access = Yes* e a regra do security group, ou tente de outra rede
(**redes de empresa/faculdade costumam bloquear a porta 5432** — teste pelo hotspot do celular).

### 5.2 Baixe o certificado da AWS

```powershell
curl.exe -fsSL -o certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

(No PowerShell é `curl.exe` — o `curl` sozinho é outro comando e dá erro com `-fsSL`.)

### 5.3 Aponte para o banco da AWS (só neste terminal)

```powershell
$env:DB_HOST="SEU-ENDPOINT.rds.amazonaws.com"; $env:DB_NAME="nestjs_base"; $env:DB_USERNAME="postgres"; $env:DB_SSL="true"; $env:DB_SSL_CA_FILE="certs/rds-global-bundle.pem"; $env:DB_PASSWORD=(Read-Host "Senha do banco")
```

A senha é pedida na hora e não fica no histórico. Confira com `$env:DB_HOST` (deve mostrar o endereço).

### 5.4 Crie o banco (só se não preencheu *Initial database name*)

```powershell
node -e "const {Client}=require('pg');const c=new Client({host:process.env.DB_HOST,user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,database:'postgres',ssl:{ca:require('fs').readFileSync('certs/rds-global-bundle.pem','utf8')}});c.connect().then(()=>c.query('CREATE DATABASE nestjs_base')).then(()=>console.log('banco criado')).catch(e=>console.error(e.message)).finally(()=>c.end())"
```

`already exists` = já existia, tudo certo.

### 5.5 Tabelas e administrador

```powershell
npm run migration:run
```

```powershell
$env:ADMIN_EMAIL="voce@seudominio.com.br"; npm run seed
```

O seed mostra a **senha gerada uma única vez** — anote. No primeiro login, troque-a e ative o 2FA.

### Alternativa sem acessar o banco do seu computador

Se a sua rede não alcança o banco, dá para a própria Lambda aplicar as migrations **uma vez**, depois do deploy (passo 6):
**Lambda → `nestjs-base-api-<stage>-api` → Configuration → Environment variables → Edit** → adicione `DB_MIGRATIONS_RUN` = `true`
→ **Save** → abra `https://SEU-ENDPOINT/api/health` (a primeira requisição aplica as migrations) → **remova** a variável.
Não deixe ligado: várias Lambdas subindo juntas tentariam migrar ao mesmo tempo. O admin (seed) ainda precisa de acesso ao banco.

---

## 6. O deploy

1. GitHub → **Actions → Deploy → Run workflow** → escolha o stage → **Run workflow**.
2. Se pedir, clique em **Review deployments** e aprove.
3. Leva ~5–10 min (testes + criação dos recursos). No fim da etapa **"Build + deploy"**:

   ```
   endpoint: ANY - https://abc123.execute-api.us-east-2.amazonaws.com
   ```

4. Abra `https://abc123.../api/health` → `{"status":"ok","database":"up"}`.
5. Swagger: `https://abc123.../docs` (só no stage `dev`, por padrão).
6. Com `ALARM_EMAIL`, a AWS manda um e-mail pedindo para **confirmar a inscrição** nos alarmes — clique, senão os alertas não chegam.

Daqui em diante, cada deploy é só o passo 6.

---

## 7. Erros comuns

| Erro (onde aparece) | Causa | Solução |
| --- | --- | --- |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` (etapa "Login na AWS") | A trust policy da role não bate com o que o GitHub envia | Compare o `sub` mostrado na etapa **"Diagnóstico do login na AWS"** com a condição da trust policy (4.3). Confira também o `AWS_ROLE_ARN` (mesma conta e nome) |
| `Invalid variable source at index ...` (Build + deploy) | Sintaxe de variável no `serverless.yml` | Valor padrão que é outra variável vai **sem** `${}`: `${param:a, param:b}` |
| `Encountered invalid "--param" CLI option value: "x="` | Parâmetro vazio | O workflow já só envia os preenchidos; confira se está usando a versão atual do `deploy.yml` |
| `Variáveis obrigatórias vazias no environment` | Falta `FRONTEND_URL`, `MAIL_FROM` ou `SUPPORT_EMAIL` | Crie no environment (4.4) |
| `Value not found at "ssm" source` | O segredo não existe **onde o deploy procurou** | Confira o nome exato (`/nestjs-base-api/<stage>/...`, com a barra inicial) e a **região** (a mesma do `AWS_REGION`) |
| `is not authorized to perform: X` / `UnauthorizedTaggingOperation` | Falta uma permissão na política do deploy | Use a versão atual de [github-deploy-policy.json](aws/github-deploy-policy.json); se a ação ainda faltar, adicione-a no bloco do serviço correspondente |
| `... is in UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS state and can not be updated` | A tentativa anterior ainda está sendo desfeita | Espere o status da stack (CloudFormation) virar `UPDATE_ROLLBACK_COMPLETE` (1–5 min) e rode de novo |
| `ROLLBACK_COMPLETE` (primeiro deploy falhou por inteiro) | Stack criada vazia | CloudFormation → a stack → **Delete** → rode o deploy de novo (não perde nada) |
| `Warning: ... provider.runtime: must be equal to one of the allowed values` | O Serverless v3 não conhece o Node 22 | Só um aviso — a AWS aceita `nodejs22.x`. Pode ignorar |
| `Test-NetConnection` → `False` / `ETIMEDOUT` | Rede não alcança o banco | *Public access*, security group, ou bloqueio da sua rede (passo 5.1) |
| `password authentication failed` | Usuário/senha do banco | Confira (e se trocou a senha no RDS, atualize o SSM e faça deploy) |
| `database "nestjs_base" does not exist` | Banco não criado | Passo 5.4 |
| `self-signed certificate` / `unable to verify` | Certificado não informado | Passo 5.2 e `DB_SSL_CA_FILE` |
| `ADMIN_PASSWORD está com um valor de exemplo` | `.env` com a senha de exemplo | Passo 5.0 |
| API demora ~30 s e responde `Internal Server Error` (sem `requestId`) | A Lambda não alcança o banco e trava ao subir | Security group do RDS só libera o **seu** IP: a Lambda (fora da VPC) sai por IPs variáveis da AWS. Libere 5432 para `0.0.0.0/0` (opção A) ou coloque a Lambda na VPC (opção B). O log do CloudWatch mostra uma linha `fatal` com o motivo |
| Rota inexistente dá 404, mas **toda rota real dá 500** (com `requestId`) | A API conectou num banco **sem as tabelas** (o 1º passo de toda rota grava em `rate_limits`) | Confira o `DB_NAME` no SSM (ex.: ficou `postgres` em vez de `nestjs_base`) ou rode as migrations (passo 5) |
| Corrigi um valor no SSM e nada mudou | O deploy **copia** os valores do SSM para a Lambda | Rode o deploy de novo (ou edite a variável direto em *Lambda → Configuration → Environment variables*) |
| `/api/health` responde `database: down` | A Lambda não alcança o banco | Mesma causa da linha do "~30 s" acima |
| Mensagens ficam **"in flight"** na fila de e-mail e não somem | O `mailWorker` está falhando a cada tentativa (até 5, a cada 3 min; depois vão para a DLQ) | Veja o motivo no log do `mailWorker` (linhas abaixo). Corrigida a causa, as que foram para a DLQ voltam com *Start DLQ redrive* |
| `not authorized to perform 'ses:SendRawEmail' on resource ...:configuration-set/...` (log do `mailWorker`) | O domínio tem um *configuration set* (o assistente do SES cria `my-first-configuration-set`) | Já coberto pelo `serverless.yml` atual (permite `configuration-set/*`); rode o deploy |
| `Email address is not verified` (log do `mailWorker`) | SES ainda no sandbox nessa região | Aguarde a liberação (3.3) ou verifique o e-mail destinatário em *SES → Identities* |
| **`Failed to fetch`** no navegador ao enviar o arquivo para o S3 | O bucket só aceita uploads vindos das origens do `CORS_ORIGIN` (padrão: `FRONTEND_URL`); o front rodando em outra origem (ex.: `localhost`) é barrado pelo CORS | Adicione a origem ao `CORS_ORIGIN` do environment e rode o deploy |
| E-mails não chegam | SES em sandbox ou domínio não verificado **na região do deploy** | Passo 3; veja também a fila de falhas (DLQ) em [DEPLOY_AWS_LAMBDA.md](DEPLOY_AWS_LAMBDA.md#fila-de-e-mails) |

Ver o motivo exato de uma falha do deploy: **CloudFormation → Stacks → `nestjs-base-api-<stage>` → aba Events**. A primeira linha
com `CREATE_FAILED`/`UPDATE_FAILED` (de baixo para cima) é a causa real.
