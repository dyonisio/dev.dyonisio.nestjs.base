import type { components } from './schema';
import { api, type ApiError } from './client';

export type FileDto = components['schemas']['FileDto'];
export type FilePurpose = components['schemas']['CreateUploadDto']['purpose'];

/**
 * Limites de cada finalidade — os mesmos de apps/api/src/files/file-purposes.ts.
 * Conferir aqui só evita um upload inútil; quem garante é a API (inclusive o conteúdo real do arquivo).
 */
export const FILE_LIMITS: Record<FilePurpose, { contentTypes: string[]; maxSize: number }> = {
  avatar: { contentTypes: ['image/jpeg', 'image/png', 'image/webp'], maxSize: 2 * 1024 * 1024 },
  document: { contentTypes: ['application/pdf'], maxSize: 10 * 1024 * 1024 },
};

/**
 * Upload em 3 passos (o arquivo vai direto do navegador para o S3, sem passar pela API):
 *  1. POST /files → a API devolve uma URL pré-assinada, válida por poucos minutos
 *  2. POST multipart para essa URL (todos os `fields` e o arquivo POR ÚLTIMO)
 *  3. POST /files/:id/complete → a API confere tamanho e conteúdo e marca como pronto
 * Depois, use o `id` onde o arquivo vai ficar (ex.: PUT /users/me/avatar).
 */
export async function uploadFile(file: File, purpose: FilePurpose): Promise<FileDto> {
  const created = await api.POST('/api/v1/files', {
    body: { purpose, contentType: file.type, size: file.size },
  });
  if (created.error || !created.data) throw created.error;
  const { file: pending, upload } = created.data;

  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append('file', file);
  const res = await fetch(upload.url, { method: upload.method, body: form });
  if (!res.ok) {
    throw { statusCode: res.status, code: 'upload.failed', message: '' } satisfies ApiError;
  }

  const done = await api.POST('/api/v1/files/{id}/complete', {
    params: { path: { id: pending.id } },
  });
  if (done.error || !done.data) throw done.error;
  return done.data;
}
