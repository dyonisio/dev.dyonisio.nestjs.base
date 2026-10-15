import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, open, rm, stat, writeFile } from 'fs/promises';
import { dirname, join, normalize, sep } from 'path';
import { PresignedUpload, StorageDriver, StoredObjectInfo } from './storage-driver';

export interface LocalUploadPolicy {
  key: string;
  contentType: string;
  maxSize: number;
  exp: number;
}

/**
 * Storage em disco para DESENVOLVIMENTO e TESTES — imita o S3 (inclusive o upload
 * direto com política assinada), para o frontend usar o mesmo fluxo nos dois.
 * As "URLs assinadas" apontam para a própria API (LocalStorageController).
 *
 * Não use em produção: na Lambda o disco é temporário e, com várias instâncias,
 * cada uma teria os seus arquivos. Em produção use STORAGE_DRIVER=s3.
 */
export class LocalStorageDriver extends StorageDriver {
  constructor(
    private readonly dir: string,
    private readonly apiBaseUrl: string,
    private readonly secret: string,
  ) {
    super();
  }

  createUpload(
    key: string,
    {
      contentType,
      maxSize,
      expiresIn,
    }: { contentType: string; maxSize: number; expiresIn: number },
  ): Promise<PresignedUpload> {
    const policy: LocalUploadPolicy = {
      key,
      contentType,
      maxSize,
      exp: Date.now() + expiresIn * 1000,
    };
    return Promise.resolve({
      url: `${this.apiBaseUrl}/api/v1/files/local-upload`,
      method: 'POST',
      fields: { policy: this.sign(policy), 'Content-Type': contentType },
      expiresIn,
    });
  }

  /** Confere a política assinada enviada junto do upload (o que o S3 faz no POST). */
  verifyPolicy(token: string): LocalUploadPolicy | null {
    const [body, sig] = token.split('.');
    if (!body || !sig || !this.safeEqual(sig, this.hmac(body))) return null;
    const policy = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LocalUploadPolicy;
    return policy.exp > Date.now() ? policy : null;
  }

  async write(key: string, content: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const path = this.pathOf(key);
    if (!existsSync(path)) return null;
    return { size: (await stat(path)).size };
  }

  async readStart(key: string, bytes: number): Promise<Buffer> {
    const handle = await open(this.pathOf(key), 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  downloadUrl(key: string, expiresIn: number): Promise<string> {
    const exp = Date.now() + expiresIn * 1000;
    const sig = this.hmac(`${key}:${exp}`);
    return Promise.resolve(`${this.fileUrl(key)}?exp=${exp}&sig=${sig}`);
  }

  /** Confere o link temporário de download gerado por downloadUrl(). */
  verifyDownload(key: string, exp: number, sig: string): boolean {
    return exp > Date.now() && this.safeEqual(sig, this.hmac(`${key}:${exp}`));
  }

  publicUrl(key: string): string {
    return this.fileUrl(key);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /** Caminho no disco — barrando "../" (o key nunca sai da pasta de uploads). */
  pathOf(key: string): string {
    const path = normalize(join(this.dir, key));
    if (!path.startsWith(normalize(this.dir) + sep)) throw new Error('Caminho de arquivo inválido');
    return path;
  }

  private fileUrl(key: string): string {
    return `${this.apiBaseUrl}/api/v1/files/local/${Buffer.from(key).toString('base64url')}`;
  }

  private sign(policy: LocalUploadPolicy): string {
    const body = Buffer.from(JSON.stringify(policy)).toString('base64url');
    return `${body}.${this.hmac(body)}`;
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
