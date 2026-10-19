import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasskeys1761800000000 implements MigrationInterface {
  name = 'AddPasskeys1761800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "passkeys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "credentialId" character varying(512) NOT NULL,
        "publicKey" text NOT NULL,
        "counter" bigint NOT NULL DEFAULT 0,
        "transports" character varying(100),
        "deviceType" character varying(20) NOT NULL,
        "backedUp" boolean NOT NULL DEFAULT false,
        "name" character varying(100) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastUsedAt" TIMESTAMP,
        CONSTRAINT "PK_passkeys_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_passkeys_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_passkeys_credentialId" ON "passkeys" ("credentialId")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_passkeys_userId" ON "passkeys" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "passkeys"`);
  }
}
