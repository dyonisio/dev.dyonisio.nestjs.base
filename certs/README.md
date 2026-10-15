# Certificados

Pasta copiada para a imagem Docker (`/app/certs`). Use para a CA do banco, para a conexão TLS
com o Postgres ser **conferida** (sem isso, alguém no caminho da rede poderia se passar pelo banco).

## Amazon RDS (ECS / Docker)

Baixe o bundle oficial da AWS para esta pasta:

```bash
curl -fsSL -o certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

e configure:

```
DB_SSL=true
DB_SSL_CA_FILE=certs/rds-global-bundle.pem
```

Na **Lambda** não é preciso: o `serverless.yml` já usa as CAs da AWS que vêm no runtime
(`NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem`).
