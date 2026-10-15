import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialIdentities1761300000000 implements MigrationInterface {
  name = 'AddSocialIdentities1761300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Contas criadas por login social não têm senha
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL`);

    await queryRunner.query(`
      CREATE TABLE "user_identities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "provider" character varying(20) NOT NULL,
        "providerUserId" character varying(255) NOT NULL,
        "email" character varying(180),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_identities_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_identities_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_identities_provider_subject" ON "user_identities" ("provider", "providerUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_identities_userId" ON "user_identities" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_identities"`);
    // Contas sem senha não cabem no NOT NULL: recebem um hash impossível (nunca bate com nenhuma senha)
    await queryRunner.query(`UPDATE "users" SET "password" = '!' WHERE "password" IS NULL`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL`);
  }
}
