/**
 * DataSource usado pela CLI do TypeORM (migrations) e pelo seed.
 * A aplicação em si usa src/database/typeorm.config.ts.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';
import configuration from '../config/configuration';
import './pg-utc';
import { buildSslOptions } from './ssl';

const { database: db } = configuration();

export default new DataSource({
  type: 'postgres',
  host: db.host,
  port: db.port,
  username: db.username,
  password: db.password,
  database: db.name,
  ssl: buildSslOptions(db),
  logging: db.logging,
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
});
