# Deploy do front e domínios próprios

O mesmo deploy (*Actions → Deploy → Run workflow*) publica a API **e** o front:

```
API (Lambda + API Gateway) ──▶ api.seudominio.com      (domínio próprio do API Gateway)
Front (S3 + CloudFront)    ──▶ app.seudominio.com      (CloudFront com HTTPS)
```

- **Front:** o build do `apps/web` vai para um bucket S3 **privado**. Só o CloudFront lê (Origin Access Control),
  com HTTPS, cache e cabeçalhos de segurança (CSP, HSTS, anti-iframe). Rotas do React como `/account` e
  `/admin/users` funcionam ao recarregar a página: o CloudFront responde o `index.html`.
- **Custo:** o CloudFront tem 1 TB e 10 milhões de requisições grátis por mês, para sempre. Um site deste porte
  fica em centavos por mês no S3.
- **Sem domínio próprio** também funciona: o site fica em `https://dxxxx.cloudfront.net` e a API no endereço do
  API Gateway.

Este guia usa o exemplo real `base.dyonisio.dev` (site) e `api.base.dyonisio.dev` (API), com o DNS no **Cloudflare**.
Com outro provedor de DNS os passos são os mesmos: só muda a tela onde você cria os registros.

## 1. Certificados (uma vez só)

O HTTPS de um domínio próprio usa um certificado do **AWS Certificate Manager (ACM)**, que é grátis e se renova
sozinho. São **dois** certificados, porque cada serviço exige o seu numa região:

| Para | Domínio | Região do certificado |
| --- | --- | --- |
| Site (CloudFront) | `base.dyonisio.dev` | **us-east-1 (N. Virginia)**, sempre, qualquer que seja a região da API |
| API (API Gateway) | `api.base.dyonisio.dev` | **a mesma região da API** (aqui, us-east-2 / Ohio) |

Para cada um:

1. No console da AWS, troque a região (canto superior direito) para a da tabela.
2. Abra **Certificate Manager → Request → Request a public certificate**.
3. Em *Fully qualified domain name*, digite o domínio. Validação: **DNS validation**. Clique em *Request*.
4. Abra o certificado. Em *Domains* aparece um **CNAME name** e um **CNAME value**.
5. No **Cloudflare** → seu domínio → **DNS → Records → Add record**:
   - **Type:** CNAME
   - **Name:** o *CNAME name* **sem** o final `.dyonisio.dev.` (ex.: de `_3f2a...base.dyonisio.dev.` fica `_3f2a...base`)
   - **Target:** o *CNAME value* inteiro (termina em `.acm-validations.aws.`)
   - **Proxy status:** desligado (nuvem cinza, "DNS only")
6. Volte ao ACM e espere o status virar **Issued** (de 1 a 30 minutos). Copie o **ARN** do certificado.

> Não apague esses registros de validação: é com eles que o ACM renova o certificado sozinho todo ano.

## 2. Permissões do deploy (uma vez só)

O deploy agora também cria o CloudFront e usa os certificados. Na AWS, abra **IAM → Roles →** a role do GitHub
(a do `AWS_ROLE_ARN`) **→** a política inline do deploy **→ Edit → JSON**, e cole o conteúdo atualizado de
[docs/aws/github-deploy-policy.json](aws/github-deploy-policy.json). Ele ganhou três blocos: `CloudFrontWeb`,
`CertificatesRead` e `ApiGatewayServiceLinkedRole`. O último deixa o deploy criar, uma vez por conta, a role interna
que o API Gateway usa para os domínios próprios (só ela: a permissão não vale para nenhuma outra role).

O stack e o bucket do front se chamam `nestjs-base-api-<stage>-web...` de propósito, dentro do prefixo que a política
já libera.

## 3. Variáveis no GitHub

Em **Settings → Environments → prod → Environment variables**:

| Variável | Valor |
| --- | --- |
| `WEB_DOMAIN` | `base.dyonisio.dev` |
| `WEB_CERTIFICATE_ARN` | o ARN do certificado do site (o de **us-east-1**) |
| `API_DOMAIN` | `api.base.dyonisio.dev` |
| `API_CERTIFICATE_ARN` | o ARN do certificado da API (o da região da API) |
| `FRONTEND_URL` | `https://base.dyonisio.dev` (links dos e-mails) |
| `CORS_ORIGIN` | `https://base.dyonisio.dev` (quem pode chamar a API e enviar uploads; mais de um, separe por vírgula) |
| `FALLBACK_LANGUAGE` | `pt-BR` (opcional): idioma de quem ainda não escolheu um. Padrão `en` |

Opcionais, para o login social no front: `WEB_GOOGLE_CLIENT_ID`, `WEB_APPLE_CLIENT_ID` e `WEB_APPLE_REDIRECT_URI`
(os mesmos client IDs de `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS`; veja [WEB.md](WEB.md#login-social-google-e-apple)).

Sem `WEB_DOMAIN`/`API_DOMAIN`, o deploy publica nos endereços da AWS. Nesse caso, depois do primeiro deploy, ponha o
endereço `https://dxxxx.cloudfront.net` do resumo em `FRONTEND_URL` e `CORS_ORIGIN` e rode de novo.

## 4. Deploy

*Actions → Deploy → Run workflow → prod*. Além dos passos da API, ele:

1. cria ou atualiza o stack do front ([web.yml](../apps/web/infra/web.yml)): bucket, CloudFront e cabeçalhos;
2. faz o build do front já apontando para a API (`VITE_API_URL`);
3. envia os arquivos para o bucket: os com hash no nome com cache de 1 ano, e o `index.html` sem cache (a versão nova
   chega na hora);
4. escreve no resumo da execução os endereços e **os registros DNS a criar**.

O **primeiro** deploy do front demora mais (de 5 a 15 min): o CloudFront leva esse tempo para se espalhar pelo mundo.
Os seguintes levam segundos.

## 5. Apontar os domínios (uma vez só)

No resumo da execução (página do deploy, embaixo) há uma tabela como esta:

| Tipo | Nome | Destino |
| --- | --- | --- |
| CNAME | `base.dyonisio.dev` | `d1234abcd.cloudfront.net` |
| CNAME | `api.base.dyonisio.dev` | `d-abc123.execute-api.us-east-2.amazonaws.com` |

No Cloudflare, crie os dois CNAMEs (Name `base` e `api.base`), com **Proxy status desligado (DNS only)**.

> **Por que sem o proxy do Cloudflare?** Com a nuvem laranja, o Cloudflare passa a terminar o HTTPS na frente da
> AWS. O certificado da AWS e o do Cloudflare entram em conflito, e aparecem erros como 525 ou "too many redirects".
> Além disso, a API passaria a ver o IP do Cloudflare em vez do IP de quem acessa, e os limites por IP deixariam de
> funcionar. A AWS já entrega HTTPS e cache: o Cloudflare só precisa resolver o nome.

Em poucos minutos:

```bash
curl -I https://base.dyonisio.dev
```

```bash
curl https://api.base.dyonisio.dev/api/health
```

## 6. Banco de dados

As migrations vão **pelo deploy**: a Lambda `migrate` aplica as pendentes antes de o código novo entrar no ar (veja
[DEPLOY_AWS_LAMBDA.md](DEPLOY_AWS_LAMBDA.md#5-migrations-e-admin-inicial)). Não há passo manual. O admin inicial (seed)
continua sendo criado do seu computador, uma vez só.

## Erros comuns

| Erro | Causa e solução |
| --- | --- |
| `The specified SSL certificate doesn't exist, isn't in us-east-1 region...` | O certificado do **site** precisa estar em **us-east-1**. Peça outro lá e troque o `WEB_CERTIFICATE_ARN` |
| `Certificate ... not found` no domínio da API | O certificado da **API** precisa estar na **mesma região** da API |
| `... is not authorized to perform: cloudfront:...` ou `acm:...` | A política da role não foi atualizada (passo 2) |
| `Caller does not have permissions to create a Service Linked Role` no `ApiCustomDomain` | Falta o bloco `ApiGatewayServiceLinkedRole` na política (passo 2). O stack volta sozinho à versão anterior (a API continua no ar); atualize a política e rode o deploy de novo |
| `CNAMEAlreadyExists` | O domínio já está em outra distribuição do CloudFront (nesta ou em outra conta). Remova-o de lá |
| Certificado parado em *Pending validation* | O CNAME de validação está errado: confira o *Name* sem o `.dyonisio.dev` final e o proxy desligado |
| Certificado em *Failed*: `CAA error` | O domínio tem registros **CAA** (quem pode emitir certificados) sem a Amazon. No Cloudflare, acrescente no `@` quatro registros CAA, *Tag* "Only allow specific hostnames" (`issue`), com `amazon.com`, `amazontrust.com`, `awstrust.com` e `amazonaws.com`. Não apague os que já existem. Um certificado que falhou não revalida: apague-o e peça outro |
| `CAA error` mesmo com a Amazon liberada | O nome (ou o "pai" dele: o `base` para o `api.base`) **já é um CNAME para outro serviço** (Vercel, Netlify...). A AWS segue o CNAME e lê o CAA **do destino**, que não libera a Amazon. Remova o CNAME antigo (o site anterior sai do ar até o deploy) ou use outro nome. Para conferir: `https://dns.google/resolve?name=base.seudominio.com&type=CAA` |
| Site abre, mas "Failed to fetch" nas telas | `CORS_ORIGIN`/`FRONTEND_URL` sem o endereço do site: corrija e rode o deploy de novo |
| Erro 525, "too many redirects" | Proxy do Cloudflare ligado: deixe os CNAMEs em "DNS only" |
| Página em branco e erro de CSP no console | Algo de fora que a CSP não libera (ex.: um script novo). Ajuste a `ContentSecurityPolicy` em [web.yml](../apps/web/infra/web.yml) |
| A versão nova não aparece | Recarregue sem cache (Ctrl+F5). O `index.html` não é cacheado e o deploy invalida o dele no CloudFront |
