import { DataSource } from 'typeorm';
import { connectionOptions } from './connection';

/**
 * Antes de cada arquivo de teste: apaga e recria o schema `public`.
 * Cada arquivo começa com o banco vazio e a aplicação aplica as migrations ao subir.
 */
beforeAll(async () => {
  const ds = await new DataSource(connectionOptions()).initialize();
  await ds.query('DROP SCHEMA public CASCADE');
  await ds.query('CREATE SCHEMA public');
  await ds.destroy();
});
