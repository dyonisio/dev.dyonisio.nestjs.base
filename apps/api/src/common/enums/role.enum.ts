/**
 * Roles da aplicação. Armazenadas como varchar no banco,
 * então adicionar uma nova role não exige migration.
 */
export enum Role {
  ADMIN = 'admin',
  MANAGER = 'manager',
  USER = 'user',
}
