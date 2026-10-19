import { MigrationInterface, QueryRunner } from 'typeorm';

/** Login por link mágico: o nonce do último link enviado (uso único, um link válido por vez). */
export class AddMagicLink1761700000000 implements MigrationInterface {
  name = 'AddMagicLink1761700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "magicLinkNonce" character varying(64)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "magicLinkNonce"`);
  }
}
