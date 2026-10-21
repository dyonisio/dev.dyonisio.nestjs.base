import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPayments1761900000000 implements MigrationInterface {
  name = 'AddPayments1761900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "planId" character varying(40) NOT NULL,
        "kind" character varying(20) NOT NULL,
        "provider" character varying(20) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "amount" integer NOT NULL,
        "currency" character varying(3) NOT NULL,
        "providerRef" character varying(255),
        "paidAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payments_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_payments_userId" ON "payments" ("userId")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_providerRef" ON "payments" ("providerRef")`,
    );

    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "planId" character varying(40) NOT NULL,
        "provider" character varying(20) NOT NULL,
        "providerSubscriptionId" character varying(255) NOT NULL,
        "status" character varying(20) NOT NULL,
        "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
        "currentPeriodEnd" TIMESTAMP,
        "canceledAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscriptions_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_userId" ON "subscriptions" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_subscriptions_provider_ref" ON "subscriptions" ("provider", "providerSubscriptionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "payments"`);
  }
}
