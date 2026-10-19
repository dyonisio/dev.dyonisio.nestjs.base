/**
 * Finalidades de upload: CADA uso de arquivo no sistema é uma entrada aqui.
 * Para um uso novo (ex.: anexo de pedido), adicione uma linha — o fluxo de upload,
 * validação e armazenamento é o mesmo para todos.
 *
 *  - contentTypes: tipos aceitos (o conteúdo real é conferido pelos primeiros bytes)
 *  - maxSize:      tamanho máximo em bytes
 *  - visibility:   public  = URL fixa e aberta (ex.: avatar, aparece para todos)
 *                  private = só o dono, por link temporário assinado
 *  - standalone:   (opcional) true = o arquivo vale por si só (ex.: "meus documentos") e
 *                  não precisa ser usado por nada. Sem isso, upload concluído que ninguém
 *                  usa (consume) em FILES_CLEANUP_AFTER_HOURS é apagado pela limpeza automática.
 */
export const FILE_PURPOSES = {
  avatar: {
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSize: 2 * 1024 * 1024,
    visibility: 'public',
  },
  document: {
    contentTypes: ['application/pdf'],
    maxSize: 10 * 1024 * 1024,
    visibility: 'private',
  },
} as const satisfies Record<string, FilePurposeConfig>;

export interface FilePurposeConfig {
  contentTypes: readonly string[];
  maxSize: number;
  visibility: 'public' | 'private';
  standalone?: boolean;
}

export type FilePurpose = keyof typeof FILE_PURPOSES;
export const FILE_PURPOSE_NAMES = Object.keys(FILE_PURPOSES) as FilePurpose[];

/** Finalidades cujo arquivo precisa ser usado (consume) para não ser apagado como lixo. */
export const purposesRequiringAttachment = (): string[] =>
  FILE_PURPOSE_NAMES.filter((name) => !(FILE_PURPOSES[name] as FilePurposeConfig).standalone);

export const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Assinaturas ("magic bytes") de cada tipo: o começo real do arquivo.
 * Impede que um arquivo qualquer renomeado para .png passe como imagem.
 */
const SIGNATURES: Record<string, (head: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('ascii') === '%PDF-',
};

export const SIGNATURE_BYTES = 16;

export function matchesSignature(contentType: string, head: Buffer): boolean {
  return SIGNATURES[contentType]?.(head) ?? false;
}
