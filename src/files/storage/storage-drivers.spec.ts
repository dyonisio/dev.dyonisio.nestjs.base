import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { matchesSignature } from '../file-purposes';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';

jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: jest.fn().mockResolvedValue({
    url: 'https://bucket.s3.amazonaws.com/',
    fields: { key: 'k', Policy: 'p', 'X-Amz-Signature': 's' },
  }),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://bucket.s3.amazonaws.com/k?X-Amz-Signature=s'),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');

describe('S3StorageDriver', () => {
  const send = jest.fn();
  const driver = new S3StorageDriver(
    { send } as unknown as S3Client,
    'bucket',
    'https://cdn.app.com',
  );

  beforeEach(() => send.mockReset());

  it('presigned POST trava o tipo e o tamanho máximo na política assinada', async () => {
    const upload = await driver.createUpload('public/avatar/u/f.png', {
      contentType: 'image/png',
      maxSize: 2048,
      expiresIn: 600,
    });

    expect(createPresignedPost).toHaveBeenCalledWith(expect.anything(), {
      Bucket: 'bucket',
      Key: 'public/avatar/u/f.png',
      Conditions: [
        ['content-length-range', 1, 2048],
        ['eq', '$Content-Type', 'image/png'],
      ],
      Fields: { 'Content-Type': 'image/png' },
      Expires: 600,
    });
    expect(upload).toMatchObject({
      method: 'POST',
      expiresIn: 600,
      url: 'https://bucket.s3.amazonaws.com/',
    });
  });

  it('head devolve o tamanho; objeto inexistente -> null; outros erros sobem', async () => {
    send.mockResolvedValueOnce({ ContentLength: 123 });
    await expect(driver.head('k')).resolves.toEqual({ size: 123 });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);

    send.mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'NotFound' }));
    await expect(driver.head('k')).resolves.toBeNull();

    send.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(driver.head('k')).rejects.toThrow('AccessDenied');
  });

  it('readStart pede só os primeiros bytes (Range)', async () => {
    send.mockResolvedValueOnce({
      Body: { transformToByteArray: () => Promise.resolve(Uint8Array.from([1, 2])) },
    });

    await expect(driver.readStart('k', 16)).resolves.toEqual(Buffer.from([1, 2]));
    const command = send.mock.calls[0][0] as GetObjectCommand;
    expect(command.input).toMatchObject({ Bucket: 'bucket', Key: 'k', Range: 'bytes=0-15' });
  });

  it('URL pública (base configurável, ex.: CloudFront), download assinado e exclusão', async () => {
    expect(driver.publicUrl('public/a.png')).toBe('https://cdn.app.com/public/a.png');
    await expect(driver.downloadUrl('private/a.pdf', 300)).resolves.toContain('X-Amz-Signature');

    send.mockResolvedValueOnce({});
    await driver.delete('k');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });
});

describe('LocalStorageDriver', () => {
  let dir: string;
  let driver: LocalStorageDriver;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'uploads-'));
    driver = new LocalStorageDriver(dir, 'http://api.test', 'segredo');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(['../fora.txt', 'public/../../fora.txt', 'public/../..'])(
    'bloqueia path traversal: %s',
    (key) => {
      expect(() => driver.pathOf(key)).toThrow('Caminho de arquivo inválido');
    },
  );

  it('caminho "absoluto" no key continua DENTRO da pasta de uploads', () => {
    expect(driver.pathOf('/etc/passwd').startsWith(dir)).toBe(true);
  });

  it('política de upload: válida, adulterada e expirada', async () => {
    const { fields } = await driver.createUpload('public/a.png', {
      contentType: 'image/png',
      maxSize: 10,
      expiresIn: 60,
    });
    expect(driver.verifyPolicy(fields.policy)).toMatchObject({ key: 'public/a.png', maxSize: 10 });
    expect(driver.verifyPolicy(fields.policy + 'x')).toBeNull();
    expect(driver.verifyPolicy('lixo')).toBeNull();

    const expired = await driver.createUpload('public/a.png', {
      contentType: 'image/png',
      maxSize: 10,
      expiresIn: -1,
    });
    expect(driver.verifyPolicy(expired.fields.policy)).toBeNull();
  });

  it('grava, lê o começo, informa o tamanho e apaga', async () => {
    await driver.write('private/doc/u/a.pdf', Buffer.from('%PDF-1.7 conteúdo'));

    await expect(driver.head('private/doc/u/a.pdf')).resolves.toEqual({ size: 18 });
    await expect(driver.readStart('private/doc/u/a.pdf', 5)).resolves.toEqual(Buffer.from('%PDF-'));
    await driver.delete('private/doc/u/a.pdf');
    await expect(driver.head('private/doc/u/a.pdf')).resolves.toBeNull();
  });

  it('link de download: válido, adulterado e expirado', async () => {
    const url = new URL(await driver.downloadUrl('private/a.pdf', 60));
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;

    expect(driver.verifyDownload('private/a.pdf', exp, sig)).toBe(true);
    expect(driver.verifyDownload('private/OUTRO.pdf', exp, sig)).toBe(false);
    expect(driver.verifyDownload('private/a.pdf', exp + 1, sig)).toBe(false);
    expect(driver.verifyDownload('private/a.pdf', Date.now() - 1, sig)).toBe(false);
  });
});

describe('assinaturas de tipo (magic bytes)', () => {
  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/webp', Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')],
    ['application/pdf', Buffer.from('%PDF-1.4')],
  ])('%s reconhecido pelo começo real do arquivo', (type, head) => {
    expect(matchesSignature(type, head)).toBe(true);
    expect(matchesSignature(type, Buffer.from('texto qualquer..'))).toBe(false);
  });

  it('tipo sem assinatura conhecida é recusado', () => {
    expect(matchesSignature('text/html', Buffer.from('<html>'))).toBe(false);
  });
});
