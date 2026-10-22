import { MigrationInterface, QueryRunner } from 'typeorm';

/** Marca o e-mail "seu Pro de cortesia termina em breve", para sair uma vez só. */
export class AddGrantEndingNotice1762200000000 implements MigrationInterface {
  name = 'AddGrantEndingNotice1762200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plan_grants" ADD "endingNoticeAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plan_grants" DROP COLUMN "endingNoticeAt"`);
  }
}
