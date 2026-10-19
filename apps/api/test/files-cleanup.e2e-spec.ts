import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { rmSync } from 'fs';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { FilesCleanupService } from '../src/files/cleanup/files-cleanup.service';
import { StoredFile } from '../src/files/file.entity';
import { FILE_PURPOSES, FilePurposeConfig } from '../src/files/file-purposes';
import { StorageDriver } from '../src/files/storage/storage-driver';
import { UsersService } from '../src/users/users.service';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 3)]);
const HOUR = 3_600_000;

describe('Limpeza automática de uploads abandonados (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let files: Repository<StoredFile>;
  let storage: StorageDriver;
  let cleanup: FilesCleanupService;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  /** Pede a URL, envia o arquivo e (opcionalmente) confirma. Devolve o id. */
  const upload = async (purpose: string, type: string, content: Buffer, complete = true) => {
    const created = await auth(http().post('/api/v1/files'))
      .send({ purpose, contentType: type, size: content.length })
      .expect(201);
    const { url, fields } = created.body.upload as { url: string; fields: object };
    let req = http().post(new URL(url).pathname);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v as string);
    await req.attach('file', content, { filename: 'f', contentType: type }).expect(204);
    if (complete)
      await auth(http().post(`/api/v1/files/${created.body.file.id}/complete`)).expect(200);
    return created.body.file.id as string;
  };

  /** "Envelhece" o upload: como se tivesse sido criado/concluído há `hours` horas. */
  const age = (id: string, hours: number) => {
    const past = new Date(Date.now() - hours * HOUR);
    return files.update(id, { createdAt: past, completedAt: past });
  };
  const exists = async (id: string) => {
    const file = await files.findOne({ where: { id } });
    return { row: !!file, content: !!file && (await storage.head(file.key)) !== null };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();
    files = app.get(getRepositoryToken(StoredFile));
    storage = app.get(StorageDriver);
    cleanup = app.get(FilesCleanupService);

    await app
      .get(UsersService)
      .create(
        { name: 'Ana', email: 'ana@test.com', password: 'Senha123' },
        { emailVerified: true },
      );
    token = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ana@test.com', password: 'Senha123' })
        .expect(200)
    ).body.accessToken;
  });

  beforeEach(() => files.clear());

  afterAll(async () => {
    await app.close();
    rmSync(process.env.STORAGE_LOCAL_DIR!, { recursive: true, force: true });
  });

  it('apaga upload pending antigo (registro e conteúdo); mantém o recente', async () => {
    const old = await upload('avatar', 'image/png', PNG, false);
    const recent = await upload('avatar', 'image/png', PNG, false);
    const { key } = await files.findOneByOrFail({ id: old });
    await age(old, 25);

    await expect(cleanup.run()).resolves.toEqual({ deleted: 1, failed: 0 });

    expect(await exists(old)).toEqual({ row: false, content: false });
    expect(await storage.head(key)).toBeNull();
    expect(await exists(recent)).toEqual({ row: true, content: true });
  });

  it('apaga upload concluído que nunca foi usado; o que virou avatar fica', async () => {
    const unused = await upload('avatar', 'image/png', PNG);
    const avatar = await upload('avatar', 'image/png', PNG);
    await auth(http().put('/api/v1/users/me/avatar')).send({ fileId: avatar }).expect(200);
    await age(unused, 25);
    await age(avatar, 25);

    await expect(cleanup.run()).resolves.toEqual({ deleted: 1, failed: 0 });

    expect(await exists(unused)).toEqual({ row: false, content: false });
    expect(await exists(avatar)).toEqual({ row: true, content: true });
    const me = await auth(http().get('/api/v1/users/me')).expect(200);
    expect(me.body.avatarUrl).toEqual(expect.any(String));
  });

  it('respeita o prazo configurado (padrão 24 h)', async () => {
    const id = await upload('avatar', 'image/png', PNG, false);
    await age(id, 23);
    await expect(cleanup.run()).resolves.toEqual({ deleted: 0, failed: 0 });
    // ...mas um job rodando 2 h depois já o considera abandonado
    await expect(cleanup.run(new Date(Date.now() + 2 * HOUR))).resolves.toMatchObject({
      deleted: 1,
    });
  });

  it('finalidade `standalone` não precisa ser usada: concluída fica, pending sai', async () => {
    const document = FILE_PURPOSES.document as FilePurposeConfig;
    document.standalone = true;
    try {
      const ready = await upload('document', 'application/pdf', PDF);
      const pending = await upload('document', 'application/pdf', PDF, false);
      await age(ready, 48);
      await age(pending, 48);

      await cleanup.run();

      expect((await exists(ready)).row).toBe(true);
      expect((await exists(pending)).row).toBe(false);
    } finally {
      delete document.standalone;
    }
  });

  it('apaga no máximo FILES_CLEANUP_BATCH_SIZE por execução (o resto fica para a próxima)', async () => {
    const ids = [
      await upload('avatar', 'image/png', PNG, false),
      await upload('avatar', 'image/png', PNG, false),
    ];
    for (const id of ids) await age(id, 30);
    const config = app.get(FilesCleanupService)['config'] as { get: (k: string) => unknown };
    const spy = jest
      .spyOn(config, 'get')
      .mockImplementation((k: string) => (k === 'storage.cleanup.batchSize' ? 1 : 24));

    await expect(cleanup.run()).resolves.toMatchObject({ deleted: 1 });
    await expect(cleanup.run()).resolves.toMatchObject({ deleted: 1 });
    spy.mockRestore();
  });
});
