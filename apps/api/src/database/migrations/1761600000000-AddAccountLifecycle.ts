import { MigrationInterface, QueryRunner } from 'typeorm';

/** Troca de e-mail com confirmação (pendingEmail) e anonimização de contas excluídas. */
export class AddAccountLifecycle1761600000000 implements MigrationInterface {
  name = 'AddAccountLifecycle1761600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "pendingEmail" character varying(180)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "anonymizedAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "anonymizedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "pendingEmail"`);
  }
}
