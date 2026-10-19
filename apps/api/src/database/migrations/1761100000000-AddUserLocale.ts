import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserLocale1761100000000 implements MigrationInterface {
  name = 'AddUserLocale1761100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "locale" character varying(10)`);
    // Quem já existia recebia os e-mails em português: mantém
    await queryRunner.query(`UPDATE "users" SET "locale" = 'pt-BR'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "locale"`);
  }
}
