# Deploy na AWS Lambda

> **Primeira vez?** Siga o [passo a passo do primeiro deploy](FIRST_DEPLOY.md) — ordem certa, explicações para iniciantes
> e os erros mais comuns. Este documento é a referência técnica de cada peça.

A API roda em uma função Lambda atrás de um **API Gateway HTTP API**, usando
[`@codegenie/serverless-express`](https://github.com/CodeGenieApp/serverless-express) para
adaptar o Express do Nest ao evento da Lambda. O deploy é feito com o **Serverless Framework v3**
(já instalado como devDependency — não precisa de instalação global nem de conta no dashboard da Serverless).

```
Cliente ──► API Gateway (HTTP API) ──► Lambda api ──► RDS Postgres (TLS conferido)
   │                                        │
   │ (upload direto, URL assinada)          ├──► S3 UploadsBucket
   └────────────────────────────────────────┘
                                            └──► SQS MailQueue ──► Lambda mailWorker ──► Amazon SES
                                                       │ (5 falhas)
                                                       └──► SQS MailDeadLetterQueue (14 dias)

EventBridge (a cada 6 h) ──► Lambda maintenance ──► RDS + S3
CloudWatch Alarms ──► SNS ──► e-mail (alarmEmail)
```

## Como funciona

| Arquivo | Papel |
| --- | --- |
| `src/lambda.ts` | Handler. Cria a app Nest **uma vez por container** e a reaproveita nas invocações seguintes (warm start). |
| `src/app.setup.ts` | Configuração compartilhada (`/api/v1`, validação, serialização, Swagger) — a mesma do `main.ts`. |
| `src/mail/worker/mail-worker-handler.ts` | Handler da `mailWorker`: consome a fila e envia os e-mails (aplicação mínima, sem banco). |
| `src/maintenance/maintenance-handler.ts` | Handler da `maintenance`: anonimização de contas, faxina de uploads, sessões e auditoria. |
| `serverless.yml` | Funções, rota `*` do HTTP API, filas, bucket, alarmes, variáveis de ambiente, permissões e empacotamento. |

O código é compilado com `nest build` e o pacote enviado contém apenas `dist/`, `package.json` e as
dependências de produção (`node_modules` sem as devDependencies).

---

## 1. Pré-requisitos

- Node.js 20+ (a Lambda usa `nodejs22.x`)
- Conta AWS e um usuário/role com permissão para CloudFormation, Lambda, API Gateway, IAM, S3, CloudWatch Logs e SSM
- AWS CLI configurada:

```bash
aws configure
```

> Também funciona com `AWS_PROFILE=meu-perfil` ou SSO (`aws sso login`).

## 2. Banco de dados (RDS Postgres)

1. Crie uma instância **RDS for PostgreSQL** (ou Aurora Serverless v2).
2. **Recomendado:** crie um **RDS Proxy** na frente do banco. Cada container da Lambda abre suas
   próprias conexões; sob carga isso esgota o `max_connections` do Postgres. O proxy faz o pool.
3. Rede — escolha uma opção:
   - **Banco público (mais simples, bom para dev):** libere a porta 5432 no Security Group. Não precisa configurar VPC na Lambda.
   - **Banco privado (recomendado em produção):** descomente o bloco `vpc:` no `serverless.yml` com as subnets privadas e um Security Group que acesse o RDS.
     Lambda em VPC **não tem internet**: para enviar e-mails pelo SES crie um **VPC Endpoint** `com.amazonaws.<região>.email` (ou um NAT Gateway).

## 3. Segredos no SSM Parameter Store

O `serverless.yml` lê os valores sensíveis do SSM no momento do deploy. Crie-os para cada stage
(troque `dev` por `prod` etc.):

```bash
aws ssm put-parameter --type SecureString --name /nestjs-base-api/dev/DB_HOST --value "meu-db.xxxx.us-east-1.rds.amazonaws.com"
```

```bash
aws ssm put-parameter --type SecureString --name /nestjs-base-api/dev/DB_NAME --value "nestjs_base"
```

```bash
aws ssm put-parameter --type SecureString --name /nestjs-base-api/dev/DB_USERNAME --value "postgres"
```

```bash
aws ssm put-parameter --type SecureString --name /nestjs-base-api/dev/DB_PASSWORD --value "senha-forte"
```

```bash
aws ssm put-parameter --type SecureString --name /nestjs-base-api/dev/JWT_SECRET --value "um-segredo-longo-e-aleatorio-com-64-caracteres-ou-mais"
```

```bash
aws ssm put-parameter --type SecureString --name /nestjs-base-api/dev/ENCRYPTION_KEY --value "outra-chave-longa-e-aleatoria-diferente-do-jwt-secret"
```

> `ENCRYPTION_KEY` cifra os segredos do 2FA no banco. **Não troque depois** sem migrar: quem tem 2FA ativo deixaria de conseguir entrar
> (o admin pode resetar o 2FA dessas contas). Gere com `openssl rand -base64 48`.

> Os valores são resolvidos no deploy e gravados como variáveis de ambiente da função (criptografadas em repouso pela KMS).
> Se precisar de rotação sem redeploy, troque por leitura do Secrets Manager em runtime.

## 4. Amazon SES (e-mails)

Na Lambda o transporte padrão é `MAIL_TRANSPORT=ses`, que usa a **IAM role da função** — sem usuário/senha SMTP.

1. No console do SES, **verifique o domínio** (recomendado, com DKIM) ou ao menos o e-mail remetente usado em `MAIL_FROM`.
2. Contas novas ficam no **sandbox**: só enviam para e-mails verificados. Solicite **production access** para enviar a qualquer destinatário.
3. Ajuste o remetente no `serverless.yml` (`params` → `mailFrom`) ou passe `--param="mailFrom=App <no-reply@seudominio.com>"`.

> Prefere outro provedor (SendGrid, Mailgun, Resend...)? Use `MAIL_TRANSPORT=smtp` e defina `SMTP_*` (guarde `SMTP_PASS` no SSM).

## 4.1 Uploads (S3) e login social

- **Bucket:** o `serverless.yml` cria o bucket de uploads (`UploadsBucket`) com CORS liberado para `frontendUrl`, leitura pública **só** em
  `public/*` (avatares) e permissão da Lambda para gravar/ler/apagar. Nada a fazer além de definir `--param="frontendUrl=https://app.seudominio.com"`.
  Para servir avatares por CDN, coloque um CloudFront na frente e defina `STORAGE_PUBLIC_URL` com o domínio dele.
- **Google:** no Google Cloud Console → *APIs & Services → Credentials*, crie os OAuth Client IDs (web, iOS, Android) e passe todos:
  `--param="googleClientIds=123-web.apps.googleusercontent.com,123-ios.apps.googleusercontent.com"`.
- **Apple:** no Apple Developer, o *Services ID* (web) e/ou o *Bundle ID* do app iOS: `--param="appleClientIds=com.seudominio.app,com.seudominio.web"`.
- Sem esses parâmetros, o login social fica desligado (a rota responde 400).
- **Manutenção:** a função `maintenance` roda sozinha a cada 6 h (EventBridge). Ela anonimiza contas excluídas há mais de 30 dias e
  apaga uploads abandonados, sessões antigas, auditoria fora da retenção e contadores de rate limit vencidos.
  Para rodar na hora: `npx serverless invoke -f maintenance` (devolve o relatório, ex.: `{"anonymizedAccounts": 0, "deletedUploads": 3, ...}`).

## 4.2 Parâmetros obrigatórios

Alguns valores **não têm padrão de propósito**: o deploy falha se faltarem, em vez de subir apontando para localhost ou com CORS
aberto. Defina-os em `params:` no `serverless.yml` (por stage) ou na linha de comando:

| Parâmetro | Exemplo | Para quê |
| --- | --- | --- |
| `frontendUrl` | `https://app.seudominio.com` | Links dos e-mails, CORS da API e do bucket |
| `mailFrom` | `Minha App <no-reply@seudominio.com>` | Remetente (verificado no SES) |
| `supportEmail` | `suporte@seudominio.com` | Contato nos e-mails |
| `alarmEmail` (opcional) | `devops@seudominio.com` | Recebe os alarmes. **Confirme a inscrição** no e-mail que a AWS envia |
| `corsOrigin` (opcional) | `https://app.com,https://admin.app.com` | Se houver mais de um front. Padrão: `frontendUrl` |
| `googleClientIds` / `appleClientIds` (opcional) | ver acima | Login social |
| `swaggerEnabled` (opcional) | `true` | Padrão: ligado só no stage `dev` |

```yaml
params:
  prod:
    frontendUrl: https://app.seudominio.com
    mailFrom: Minha App <no-reply@seudominio.com>
    supportEmail: suporte@seudominio.com
    alarmEmail: devops@seudominio.com
```

## 4.3 Conexão segura com o banco

O `serverless.yml` liga `DB_SSL=true` e usa as CAs da AWS que vêm no runtime da Lambda (`NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem`).
O certificado do RDS é **conferido**: ninguém no caminho da rede consegue se passar pelo banco. Nada a configurar.
Se o seu Postgres não for o RDS, aponte `DB_SSL_CA_FILE` para a CA dele.

## 5. Migrations e admin inicial

O deploy **não** roda migrations (rodar DDL no cold start de várias Lambdas em paralelo é arriscado).
Rode-as a partir da sua máquina, apontando para o banco da AWS — o passo a passo no Windows (PowerShell, certificado,
variáveis só no terminal, criação do banco) está em [FIRST_DEPLOY.md → 5](FIRST_DEPLOY.md#5-criar-as-tabelas-e-o-administrador):

```bash
npm run migration:run
```

```bash
npm run seed
```

Sem `ADMIN_PASSWORD`, o seed gera uma senha forte e a mostra **uma vez** no terminal. Entre com ela, troque-a e ative o 2FA.

## 6. Deploy

```bash
npm run deploy
```

Isso executa `nest build` + `serverless deploy` (stage `dev`). A região vem de `--region`, senão da variável `AWS_REGION`,
senão `us-east-1` — **precisa ser a mesma dos segredos (SSM) e do SES**. Ao final o Serverless mostra a URL:

```
endpoint: ANY - https://abc123.execute-api.us-east-1.amazonaws.com
```

- Health check: `https://abc123.execute-api.us-east-1.amazonaws.com/api/health`
- API: `https://abc123.execute-api.us-east-1.amazonaws.com/api/v1/...`
- Swagger: `https://abc123.execute-api.us-east-1.amazonaws.com/docs` (só no stage `dev`, por padrão)

Outros stages/regiões:

```bash
npm run deploy:prod
```

```bash
npm run build && npx serverless deploy --stage hml --region sa-east-1
```

Parâmetros por stage ficam em `params:` no `serverless.yml`; também é possível sobrescrever na linha de comando:

```bash
npx serverless deploy --stage prod --param="frontendUrl=https://app.seudominio.com" --param="mailFrom=App <no-reply@seudominio.com>" --param="supportEmail=suporte@seudominio.com"
```

## 7. Testar antes de subir

Invocar o handler compilado com um evento fake do API Gateway (sem AWS, usando o `.env`):

```bash
npm run build && npm run lambda:invoke -- GET /api/health
```

Emular o API Gateway localmente na porta 3000 (requer as variáveis acessíveis — o `serverless offline`
também resolve os parâmetros `${ssm:...}`, então precisa de credenciais AWS):

```bash
npm run offline
```

## 8. Operação

Logs em tempo real (API e worker de e-mails):

```bash
npx serverless logs -f api --tail
```

```bash
npx serverless logs -f mailWorker --tail
```

Os logs saem em **JSON** — no console do CloudWatch use o **Logs Insights** para filtrar, por exemplo, uma requisição
pelo id que o usuário recebeu no erro (`requestId`), todos os erros (`level >= 50`) ou as requisições de um usuário (`userId`):

```
fields @timestamp, msg, res.statusCode, responseTime, userId
| filter requestId = "8f1c..."
| sort @timestamp desc
```

### Fila de e-mails

- **E-mails "presos":** mensagens que falharam 5 vezes ficam na DLQ `nestjs-base-api-<stage>-mail-dlq` por 14 dias.
  Corrigida a causa (ex.: domínio do SES não verificado), reenvie-as para a fila principal pelo console do SQS
  (*Start DLQ redrive*) — ou investigue o conteúdo em *Send and receive messages → Poll for messages*.
- **Alarme:** já criado (`<service>-<stage>-mail-dlq`), avisa quando a DLQ recebe mensagens.
- **VPC:** o worker não acessa o banco. Se você ativar o bloco `vpc:` no nível do `provider`, ele também entra na VPC e
  precisará de um **VPC Endpoint do SES** (ou NAT) para enviar e-mails — e a API precisará de um **VPC Endpoint do SQS**
  para publicar na fila. Alternativa: declare o `vpc:` só na função `api`.
- **Sem fila:** para enviar direto da API (como em desenvolvimento), troque `MAIL_DELIVERY: sqs` por `sync` no `serverless.yml`.

### Alarmes

O `serverless.yml` cria um tópico SNS (`<service>-<stage>-alarms`) e estes alarmes. Com o parâmetro `alarmEmail`, chegam por e-mail
(confirme a inscrição na primeira vez):

| Alarme | Dispara quando | Onde investigar |
| --- | --- | --- |
| `api-5xx` | 5+ respostas de erro do servidor em 5 min | Logs da função `api`, filtrando `level >= 50` |
| `api-errors` | A função `api` falhou (crash, timeout) | Logs da função `api` |
| `maintenance-errors` | O job de manutenção falhou em alguma tarefa | Logs da função `maintenance` (o relatório diz qual) |
| `mail-dlq` | E-mails desistiram depois de 5 tentativas | Seção "Fila de e-mails" acima |

Para mandar ao Slack/Teams, inscreva no mesmo tópico SNS uma integração (ex.: AWS Chatbot).

Remover tudo que foi criado (função, API, logs, bucket de deploy):

```bash
npx serverless remove --stage dev
```

### Dicas de produção

- **Cold start:** `memorySize: 1024` e `arm64` já ajudam. Para latência constante use *Provisioned Concurrency* (`provisionedConcurrency: 1` na função).
- **Conexões:** mantenha `DB_POOL_MAX` em 1–2 e use RDS Proxy.
- **Domínio próprio:** crie um *Custom Domain* no API Gateway (com certificado do ACM) e aponte o DNS.
- **Rate limiting:** os contadores da aplicação ficam na tabela `rate_limits` (compartilhada entre as Lambdas). Contra grandes volumes,
  some a isso o throttling do API Gateway (`provider.httpApi` → *Default route throttling* no console) e/ou o AWS WAF, que barram antes de invocar a Lambda.
  Na Lambda o `TRUST_PROXY` fica em 0 (o API Gateway já entrega o IP real do cliente).
- **Configuração validada no boot:** como o `serverless.yml` usa `NODE_ENV=production`, a função **não sobe** com configuração insegura
  (veja [SECURITY.md](SECURITY.md#infraestrutura-e-configuração)). O erro aparece nos logs do CloudWatch logo na primeira requisição.
- **Checklist completo:** [SECURITY.md → Checklist de produção](SECURITY.md#checklist-de-produção).
- **Serverless Framework v4:** funciona com o mesmo `serverless.yml` (troque `frameworkVersion` para `'4'`), mas exige login/licença para organizações acima do limite gratuito. A v3 usada aqui é livre.

## 9. Deploy pelo GitHub Actions

O workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) faz o deploy **manualmente**, por um botão no GitHub
(*Actions → Deploy → Run workflow*). Ele roda os testes e, se passarem, faz `serverless deploy` no stage escolhido.

A autenticação na AWS usa **OIDC**: o GitHub prova para a AWS "sou o workflow do repositório X" e recebe credenciais temporárias.
Não há chave de acesso (`AWS_ACCESS_KEY_ID`) guardada em lugar nenhum. Configuração única:

1. **IAM → Identity providers → Add provider**: tipo *OpenID Connect*, URL `https://token.actions.githubusercontent.com`,
   audience `sts.amazonaws.com`.
2. **IAM → Roles → Create role** → *Custom trust policy*, restrita ao seu repositório.

   Políticas prontas (troque `SEU_ACCOUNT_ID`, o repositório e, se renomeou o projeto, o prefixo `nestjs-base-api`):
   - confiança (quem pode assumir a role): [docs/aws/github-trust-policy.json](aws/github-trust-policy.json)

     **Atenção ao formato do `sub`:** o GitHub pode enviar o formato com os IDs numéricos do dono e do
     repositório (`repo:dono@123/repo@456:environment:prod`) ou o antigo (`repo:dono/repo:environment:prod`).
     O modelo aceita os dois — troque os nomes e os números pelos seus. Para descobrir os números, rode o
     deploy uma vez: a etapa "Diagnóstico do login na AWS" mostra o `sub` exato que a AWS recebe.
   - permissões do deploy, limitadas aos recursos `nestjs-base-api-*`: [docs/aws/github-deploy-policy.json](aws/github-deploy-policy.json)
3. **GitHub → Settings → Environments**: crie `dev` e `prod`. Em `prod`, ative *Required reviewers* para exigir aprovação
   antes de cada deploy em produção.
4. Em cada environment, crie as **variáveis**:

   | Variável | Obrigatória | Valor |
   | --- | --- | --- |
   | `AWS_ROLE_ARN` | sim | ARN da role acima |
   | `FRONTEND_URL`, `MAIL_FROM`, `SUPPORT_EMAIL` | sim | os parâmetros obrigatórios (seção 4.2) |
   | `AWS_REGION` | se não for `us-east-1` | região do deploy — a mesma dos segredos (SSM) e do SES |
   | `ALARM_EMAIL`, `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` | não | opcionais (vazios não são enviados) |

   O workflow passa esses valores ao `serverless deploy` por variáveis de ambiente, sem interpolar no script (evita injeção de comandos).

**Migrations no deploy:** o runner do GitHub roda fora da sua VPC. Se o RDS estiver em subnet privada (recomendado), ele não
alcança o banco — rode as migrations por um caminho com acesso (máquina com VPN/bastion, CodeBuild na VPC ou uma Lambda de
migração). Se o banco for acessível, descomente o passo "Migrations" no workflow e cadastre os segredos `DB_*` e `JWT_SECRET`.

### Alternativa: AWS SAM / console

O handler é um Lambda padrão — qualquer ferramenta serve. Basta empacotar `dist/`, `package.json` e
`node_modules` de produção (`npm ci --omit=dev`) em um zip, definir o handler como `dist/lambda.handler`,
o runtime `nodejs22.x`, as variáveis de ambiente do `.env.example` e um gatilho de API Gateway HTTP API com rota `$default`.

## 10. Alternativa: container no ECS (Fargate)

Quando o tráfego crescer a ponto de a Lambda ficar mais cara que um container sempre ligado (ou você quiser WebSockets, jobs longos...),
o mesmo código roda pelo [Dockerfile](../Dockerfile). Nada no código muda — só onde ele roda.

1. **Imagem no ECR:**

```bash
aws ecr create-repository --repository-name nestjs-base-api
```

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin <conta>.dkr.ecr.us-east-1.amazonaws.com
```

```bash
docker build --platform linux/arm64 -t <conta>.dkr.ecr.us-east-1.amazonaws.com/nestjs-base-api:v1 .
```

```bash
docker push <conta>.dkr.ecr.us-east-1.amazonaws.com/nestjs-base-api:v1
```

2. **Task definition (Fargate):** porta 3000, `ARM64`, 0.5 vCPU / 1 GB para começar. As mesmas variáveis do `serverless.yml`; os segredos
   (`DB_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`...) entram pelo campo `secrets` apontando para os **mesmos parâmetros do SSM**.
   A *task role* precisa das mesmas permissões que a Lambda tem hoje (SES, SQS se usar fila, S3 do bucket de uploads).
3. **TLS com o RDS:** baixe a CA da AWS para `certs/` antes do `docker build` (veja [certs/README.md](../certs/README.md)) e defina
   `DB_SSL=true` e `DB_SSL_CA_FILE=certs/rds-global-bundle.pem`.
4. **Serviço + ALB:** Application Load Balancer na frente, health check em `/api/health`. Defina **`TRUST_PROXY=1`** (obrigatório fora da
   Lambda — a API não sobe sem ele): sem isso, o rate limit veria o IP do ALB em vez do IP do cliente.
5. **Migrations:** rode uma task avulsa com a mesma imagem antes de trocar a versão do serviço:
   comando `npm run migration:run:prod` (usa o JS compilado em `dist/`, não precisa de ts-node).
6. **Banco:** com containers de vida longa, aumente `DB_POOL_MAX` (ex.: 10) — o pool é reaproveitado entre requisições.
7. **Fila de e-mails:** se usar `MAIL_DELIVERY=sqs`, o worker pode continuar como Lambda (`mailWorker`) consumindo a mesma fila.
8. **Manutenção:** ou mantenha a Lambda `maintenance`, ou crie uma *Scheduled Task* do ECS (EventBridge, ex.: `rate(6 hours)`)
   com a mesma imagem e o comando `npm run maintenance:prod`.

> A imagem ainda não foi construída/testada neste repositório (sem Docker no ambiente de desenvolvimento); rode `docker build` uma vez antes do primeiro deploy.

