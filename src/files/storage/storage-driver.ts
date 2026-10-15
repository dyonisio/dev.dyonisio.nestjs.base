/**
 * Interface de armazenamento: o resto do sistema não sabe se os arquivos estão no S3
 * ou no disco. Trocar de provedor (S3 -> R2, GCS...) é escrever outra implementação.
 */
export interface PresignedUpload {
  /** O navegador faz um POST multipart para esta URL... */
  url: string;
  method: 'POST';
  /** ...com estes campos de formulário (na ordem) e, por último, o campo "file". */
  fields: Record<string, string>;
  expiresIn: number;
}

export interface StoredObjectInfo {
  size: number;
}

export abstract class StorageDriver {
  /** URL assinada para o navegador enviar o arquivo direto ao storage (tipo e tamanho travados). */
  abstract createUpload(
    key: string,
    options: { contentType: string; maxSize: number; expiresIn: number },
  ): Promise<PresignedUpload>;

  /** Dados do objeto, ou null se ele não existe (upload não feito). */
  abstract head(key: string): Promise<StoredObjectInfo | null>;

  /** Primeiros bytes do arquivo (para conferir a assinatura do tipo). */
  abstract readStart(key: string, bytes: number): Promise<Buffer>;

  /** Link temporário para baixar um arquivo privado. */
  abstract downloadUrl(key: string, expiresIn: number): Promise<string>;

  /** URL fixa de um arquivo público (prefixo public/). */
  abstract publicUrl(key: string): string;

  abstract delete(key: string): Promise<void>;
}
