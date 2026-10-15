import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileAttachedAt1761500000000 implements MigrationInterface {
  name = 'AddFileAttachedAt1761500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "files" ADD "attachedAt" TIMESTAMP`);
    // Avatares que já existem estão em uso: não podem ser vistos como lixo pela limpeza
    await queryRunner.query(`
      UPDATE "files" SET "attachedAt" = COALESCE("completedAt", now())
      WHERE "id" IN (SELECT "avatarFileId" FROM "users" WHERE "avatarFileId" IS NOT NULL)
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_files_status_createdAt" ON "files" ("status", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_files_status_createdAt"`);
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "attachedAt"`);
  }
}
