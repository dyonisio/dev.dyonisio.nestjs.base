import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeleteAndAuditLogs1760900000000 implements MigrationInterface {
  name = 'AddSoftDeleteAndAuditLogs1760900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Soft delete de usuários
    await queryRunner.query(`ALTER TABLE "users" ADD "deletedAt" TIMESTAMP`);
    // E-mail único só entre usuários não excluídos (índice parcial)
    await queryRunner.query(`DROP INDEX "public"."UQ_users_email"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_users_email_active" ON "users" ("email") WHERE "deletedAt" IS NULL`,
    );

    // Trilha de auditoria (sem FK para users: o registro sobrevive ao usuário)
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "action" character varying(60) NOT NULL,
        "actorId" uuid,
        "targetType" character varying(30),
        "targetId" character varying(64),
        "metadata" text,
        "ip" character varying(64),
        "userAgent" character varying(255),
        "requestId" character varying(128),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_actor" ON "audit_logs" ("actorId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_target" ON "audit_logs" ("targetType", "targetId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_createdAt" ON "audit_logs" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    // Usuários excluídos (soft delete) deixariam o índice único antigo inválido: removemos de vez
    await queryRunner.query(`DELETE FROM "users" WHERE "deletedAt" IS NOT NULL`);
    await queryRunner.query(`DROP INDEX "public"."UQ_users_email_active"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email")`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
  }
}
