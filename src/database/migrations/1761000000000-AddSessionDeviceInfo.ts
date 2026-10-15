import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionDeviceInfo1761000000000 implements MigrationInterface {
  name = 'AddSessionDeviceInfo1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sessions" ADD "userAgent" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "sessions" ADD "ip" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "sessions" ADD "lastUsedAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "lastUsedAt"`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "ip"`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "userAgent"`);
  }
}
