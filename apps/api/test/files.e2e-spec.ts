import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { rmSync } from 'fs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { UsersService } from '../src/users/users.service';

/** Arquivos pequenos com as assinaturas reais de cada tipo. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 3)]);
const FAKE_PNG = Buffer.from('isto é um texto qualquer renomeado para .png');

/** Caminho (+ query) de uma URL absoluta devolvida pela API — o supertest usa caminhos. */
const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

describe('Upload de arquivos e avatar (e2e)', () => {
  let app: INestApplication<App>;
  let ana: string;
  let bia: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', 'pt-BR');

  /** Passo 1: pede a URL de upload. */
  const createUpload = (token: string, body: object) =>
    as(token, http().post('/api/v1/files')).send(body);

  /** Passo 2: envia o arquivo como o navegador faria (campos assinados + arquivo por último). */
  const send = (
    upload: { url: string; fields: Record<string, string> },
    content: Buffer,
    type: string,
  ) => {
    let req = http().post(pathOf(upload.url));
    for (const [k, v] of Object.entries(upload.fields)) req = req.field(k, v);
    return req.attach('file', content, { filename: 'arquivo', contentType: type });
  };

  /** Os 3 passos: pedir, enviar, confirmar. */
  const uploadFile = async (
    token: string,
    purpose: string,
    type: string,
    content: Buffer,
    expectedStatus = 200,
  ) => {
    const created = await createUpload(token, {
      purpose,
      contentType: type,
      size: content.length,
    }).expect(201);
    await send(created.body.upload, content, type).expect(204);
    return as(token, http().post(`/api/v1/files/${created.body.file.id}/complete`)).expect(
      expectedStatus,
    );
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false })) as INestApplication<App>;
    await app.init();

    const users = app.get(UsersService);
    const tokens: string[] = [];
    for (const email of ['ana@test.com', 'bia@test.com']) {
      await users.create({ name: 'X', email, password: 'Senha123' }, { emailVerified: true });
      tokens.push(
        (await http().post('/api/v1/auth/login').send({ email, password: 'Senha123' }).expect(200))
          .body.accessToken,
      );
    }
    [ana, bia] = tokens;
  });

  afterAll(async () => {
    await app.close();
    // pasta de uploads deste processo de teste (definida em setup-env.ts)
    rmSync(process.env.STORAGE_LOCAL_DIR!, { recursive: true, force: true });
  });

  describe('avatar (finalidade pública)', () => {
    let firstUrl: string;
    let firstId: string;

    it('fluxo completo: pedir URL -> enviar direto ao storage -> confirmar -> definir avatar', async () => {
      const created = await createUpload(ana, {
        purpose: 'avatar',
        contentType: 'image/png',
        size: PNG.length,
      }).expect(201);

      expect(created.body.file).toMatchObject({ purpose: 'avatar', status: 'pending', url: null });
      expect(created.body.upload).toMatchObject({
        method: 'POST',
        url: expect.stringMatching(/\/api\/v1\/files\/local-upload$/),
        fields: { policy: expect.any(String), 'Content-Type': 'image/png' },
        expiresIn: 600,
      });

      await send(created.body.upload, PNG, 'image/png').expect(204);

      const done = await as(
        ana,
        http().post(`/api/v1/files/${created.body.file.id}/complete`),
      ).expect(200);
      expect(done.body).toMatchObject({
        status: 'ready',
        size: PNG.length,
        url: expect.any(String),
      });

      const me = await as(ana, http().put('/api/v1/users/me/avatar'))
        .send({ fileId: created.body.file.id })
        .expect(200);
      expect(me.body.avatarUrl).toBe(done.body.url);
      expect(me.body).not.toHaveProperty('avatarFileId');

      firstUrl = me.body.avatarUrl;
      firstId = created.body.file.id;
    });

    it('a URL do avatar é pública e devolve a imagem', async () => {
      const res = await http().get(pathOf(firstUrl)).buffer(true).expect(200);
      expect(res.headers['content-type']).toMatch(/^image\/png/);
      expect(Buffer.from(res.body as Buffer).equals(PNG)).toBe(true);
    });

    it('trocar o avatar apaga o arquivo anterior', async () => {
      const done = await uploadFile(ana, 'avatar', 'image/jpeg', JPEG);
      await as(ana, http().put('/api/v1/users/me/avatar'))
        .send({ fileId: done.body.id })
        .expect(200);

      await http().get(pathOf(firstUrl)).expect(404);
      await as(ana, http().get(`/api/v1/files/${firstId}`)).expect(404);
    });

    it('remover o avatar', async () => {
      const res = await as(ana, http().delete('/api/v1/users/me/avatar')).expect(200);
      expect(res.body.avatarUrl).toBeNull();
    });
  });

  describe('validações', () => {
    it('tipo não permitido para a finalidade -> 400 com os tipos aceitos', async () => {
      const res = await createUpload(ana, {
        purpose: 'avatar',
        contentType: 'application/pdf',
        size: 100,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'files.invalidType',
        message: 'Tipo de arquivo não permitido. Aceitos: image/jpeg, image/png, image/webp',
      });
    });

    it('tamanho declarado acima do limite -> 400', async () => {
      const res = await createUpload(ana, {
        purpose: 'avatar',
        contentType: 'image/png',
        size: 3 * 1024 * 1024,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'files.tooLarge',
        message: 'Arquivo muito grande. Máximo: 2 MB',
      });
    });

    it('declarar pequeno e enviar grande não funciona: o storage recusa (como o S3)', async () => {
      const created = await createUpload(ana, {
        purpose: 'avatar',
        contentType: 'image/png',
        size: 100,
      }).expect(201);
      const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
      await send(created.body.upload, big, 'image/png').expect(400);
    });

    it('arquivo disfarçado (texto com Content-Type de PNG) é recusado e descartado na confirmação', async () => {
      const res = await uploadFile(ana, 'avatar', 'image/png', FAKE_PNG, 400);
      expect(res.body.code).toBe('files.invalidContent');
    });

    it('confirmar antes de enviar -> 400', async () => {
      const created = await createUpload(ana, {
        purpose: 'avatar',
        contentType: 'image/png',
        size: 10,
      }).expect(201);
      const res = await as(
        ana,
        http().post(`/api/v1/files/${created.body.file.id}/complete`),
      ).expect(400);
      expect(res.body.code).toBe('files.notUploaded');
    });

    it('política de upload adulterada -> 403', async () => {
      const created = await createUpload(ana, {
        purpose: 'avatar',
        contentType: 'image/png',
        size: 10,
      }).expect(201);
      const upload = created.body.upload;
      upload.fields.policy = upload.fields.policy.replace(/.$/, (c: string) =>
        c === 'A' ? 'B' : 'A',
      );
      await send(upload, PNG, 'image/png').expect(403);
    });

    it('usar como avatar um arquivo de outra finalidade -> 400', async () => {
      const doc = await uploadFile(ana, 'document', 'application/pdf', PDF);
      const res = await as(ana, http().put('/api/v1/users/me/avatar'))
        .send({ fileId: doc.body.id })
        .expect(400);
      expect(res.body.code).toBe('files.invalidFile');
    });
  });

  describe('arquivos privados (finalidade document)', () => {
    let fileId: string;
    let url: string;

    it('o link de download é temporário e assinado', async () => {
      const done = await uploadFile(ana, 'document', 'application/pdf', PDF);
      fileId = done.body.id;
      url = done.body.url;
      expect(url).toMatch(/\?exp=\d+&sig=/);

      const res = await http().get(pathOf(url)).buffer(true).expect(200);
      expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    });

    it('sem a assinatura, ou com ela adulterada -> 403', async () => {
      await http().get(new URL(url).pathname).expect(403);
      await http().get(pathOf(url).replace(/sig=./, 'sig=X')).expect(403);
    });

    it('"public/../" não transforma um arquivo privado em público (403)', async () => {
      const { pathname } = new URL(url);
      const encoded = pathname.split('/').pop()!;
      const key = Buffer.from(encoded, 'base64url').toString('utf8');
      const trick = Buffer.from(`public/../${key}`).toString('base64url');
      await http().get(pathname.replace(encoded, trick)).expect(403);
    });

    it('limite de uploads pendentes por usuário (abuso de armazenamento) -> 429', async () => {
      const pending: string[] = [];
      for (let i = 0; i < 20; i++) {
        const res = await createUpload(bia, {
          purpose: 'document',
          contentType: 'application/pdf',
          size: 100,
        });
        if (res.status === 201) pending.push(res.body.file.id);
      }
      await createUpload(bia, {
        purpose: 'document',
        contentType: 'application/pdf',
        size: 100,
      }).expect(429);
      for (const id of pending) await as(bia, http().delete(`/api/v1/files/${id}`)).expect(204);
    });

    it('outra pessoa não acessa, confirma nem apaga o arquivo (404)', async () => {
      await as(bia, http().get(`/api/v1/files/${fileId}`)).expect(404);
      await as(bia, http().post(`/api/v1/files/${fileId}/complete`)).expect(404);
      await as(bia, http().delete(`/api/v1/files/${fileId}`)).expect(404);
    });

    it('o dono apaga o arquivo', async () => {
      await as(ana, http().delete(`/api/v1/files/${fileId}`)).expect(204);
      await http().get(pathOf(url)).expect(404);
    });
  });

  it('exige autenticação', () => http().post('/api/v1/files').send({}).expect(401));
});
