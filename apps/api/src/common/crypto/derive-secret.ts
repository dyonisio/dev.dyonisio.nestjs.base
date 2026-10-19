import { hkdfSync } from 'crypto';

/**
 * Deriva, do JWT_SECRET, um segredo próprio para cada finalidade (HKDF-SHA256).
 * Um token de "confirmar e-mail" nunca é aceito como "redefinir senha" ou como access token,
 * e conhecer um segredo derivado não revela o principal nem os outros.
 *
 * @param context dado extra que, se mudar, invalida os tokens já emitidos
 *   (ex.: o hash da senha, para o link de redefinição valer uma vez só)
 */
export function deriveSecret(master: string, purpose: string, context = ''): string {
  return Buffer.from(
    hkdfSync('sha256', master, 'nestjs-base', `${purpose}\u0000${context}`, 32),
  ).toString('base64url');
}

/** Único algoritmo aceito nos JWTs que a própria API emite (evita confusão de algoritmo). */
export const JWT_ALGORITHM = 'HS256' as const;
