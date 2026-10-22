import { MigrationInterface, QueryRunner } from 'typeorm';

/** Pro de cortesia dado pelo admin, até uma data. */
export class AddPlanGrants1762100000000 implements MigrationInterface {
  name = 'AddPlanGrants1762100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "plan_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "endsAt" TIMESTAMP NOT NULL,
        "reason" character varying(200) NOT NULL,
        "grantedById" uuid,
        "revokedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plan_grants_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_plan_grants_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_plan_grants_userId" ON "plan_grants" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "plan_grants"`);
  }
}
