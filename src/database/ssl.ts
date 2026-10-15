import { readFileSync } from 'fs';
import configuration from '../config/configuration';

type DatabaseConfig = ReturnType<typeof configuration>['database'];

/**
 * TLS da conexão com o Postgres. Por padrão o certificado do servidor É conferido
 * (sem isso, alguém no caminho da rede poderia se passar pelo banco).
 * O RDS usa uma CA própria da AWS: baixe o bundle e aponte DB_SSL_CA_FILE para ele
 * (veja docs/DEPLOY_AWS_LAMBDA.md).
 */
export function buildSslOptions(db: DatabaseConfig) {
  if (!db.ssl) return false;
  return {
    rejectUnauthorized: db.sslRejectUnauthorized,
    ...(db.sslCaFile ? { ca: readFileSync(db.sslCaFile, 'utf8') } : {}),
  };
}
