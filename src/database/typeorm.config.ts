import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';
import configuration from '../config/configuration';
import { buildSslOptions } from './ssl';

type DatabaseConfig = ReturnType<typeof configuration>['database'];

export function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  const db = config.getOrThrow<DatabaseConfig>('database');

  // Banco em memória — usado nos testes e2e (não precisa de Postgres rodando)
  if (db.type === 'sqljs') {
    return {
      type: 'sqljs',
      autoLoadEntities: true,
      synchronize: true,
      logging: db.logging,
    };
  }

  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.name,
    ssl: buildSslOptions(db),
    autoLoadEntities: true,
    synchronize: db.synchronize,
    logging: db.logging,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    // Aplica migrations pendentes ao subir. Útil em testes/ambientes simples;
    // na Lambda prefira rodar `npm run migration:run` no deploy (várias instâncias sobem juntas).
    migrationsRun: db.migrationsRun,
    extra: { max: db.poolMax },
  };
}
