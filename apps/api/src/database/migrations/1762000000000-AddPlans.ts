import { MigrationInterface, QueryRunner } from 'typeorm';

/** Planos editáveis pelo admin. Os de exemplo entram na subida da API (PlansService), se vazia. */
export class AddPlans1762000000000 implements MigrationInterface {
  name = 'AddPlans1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "plans" (
        "id" character varying(40) NOT NULL,
        "kind" character varying(20) NOT NULL,
        "interval" character varying(10),
        "amount" integer NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'BRL',
        "nameEn" character varying(80) NOT NULL,
        "namePt" character varying(80) NOT NULL,
        "descriptionEn" character varying(200) NOT NULL DEFAULT '',
        "descriptionPt" character varying(200) NOT NULL DEFAULT '',
        "active" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "providerProducts" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plans_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "plans"`);
  }
}
