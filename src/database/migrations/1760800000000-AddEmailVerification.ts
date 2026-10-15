import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailVerification1760800000000 implements MigrationInterface {
  name = 'AddEmailVerification1760800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "emailVerifiedAt" TIMESTAMP`);
    // Usuários que já existiam antes da verificação de e-mail continuam com acesso total
    await queryRunner.query(`UPDATE "users" SET "emailVerifiedAt" = "createdAt"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "emailVerifiedAt"`);
  }
}
