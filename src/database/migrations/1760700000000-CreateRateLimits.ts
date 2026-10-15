import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRateLimits1760700000000 implements MigrationInterface {
  name = 'CreateRateLimits1760700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rate_limits" (
        "key" character varying(255) NOT NULL,
        "hits" integer NOT NULL,
        "expiresAt" bigint NOT NULL,
        CONSTRAINT "PK_rate_limits_key" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rate_limits"`);
  }
}
