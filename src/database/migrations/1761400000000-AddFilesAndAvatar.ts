import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFilesAndAvatar1761400000000 implements MigrationInterface {
  name = 'AddFilesAndAvatar1761400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ownerId" uuid NOT NULL,
        "purpose" character varying(30) NOT NULL,
        "key" character varying(512) NOT NULL,
        "contentType" character varying(100) NOT NULL,
        "size" integer NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "completedAt" TIMESTAMP,
        CONSTRAINT "PK_files_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_files_ownerId" FOREIGN KEY ("ownerId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_files_ownerId" ON "files" ("ownerId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_files_key" ON "files" ("key")`);

    await queryRunner.query(`ALTER TABLE "users" ADD "avatarUrl" character varying(500)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "avatarFileId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatarFileId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatarUrl"`);
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
