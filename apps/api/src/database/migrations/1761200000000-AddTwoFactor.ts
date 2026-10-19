import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTwoFactor1761200000000 implements MigrationInterface {
  name = 'AddTwoFactor1761200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "twoFactorEnabledAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "users" ADD "twoFactorSecret" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD "twoFactorLastStep" integer`);
    await queryRunner.query(`ALTER TABLE "users" ADD "twoFactorRecoveryCodes" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twoFactorRecoveryCodes"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twoFactorLastStep"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twoFactorSecret"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twoFactorEnabledAt"`);
  }
}
