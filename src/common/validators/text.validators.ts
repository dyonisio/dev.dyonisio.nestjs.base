import { applyDecorators } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches, MaxLength, ValidateBy } from 'class-validator';
import { i18nValidationMessage } from '../../i18n/i18n-validation';

/**
 * Texto obrigatório com tamanho máximo. Use em TODO campo de texto livre (tokens, senhas
 * digitadas no login...): sem limite, alguém manda megabytes e a API gasta CPU à toa.
 */
export function IsBoundedString(max: number) {
  return applyDecorators(
    IsString(),
    IsNotEmpty(),
    MaxLength(max, { message: i18nValidationMessage() }),
  );
}

/**
 * Nome de pessoa: letras (de qualquer idioma, com acentos), espaço, apóstrofo, hífen e ponto.
 * Sem números, "://" ou "<>": o nome aparece nos e-mails e não pode virar link de phishing.
 */
// Ponto só como abreviação ("J. Silva"): seguido de espaço ou no fim — "site.com" não passa
export const PERSON_NAME_PATTERN = /^[\p{L}\p{M}](?:[\p{L}\p{M}'’ -]|\.(?=\s|$))*$/u;

export function IsPersonName() {
  return Matches(PERSON_NAME_PATTERN, {
    message: i18nValidationMessage('validation.personName'),
  });
}

/**
 * Converte um nome vindo de fora (ex.: Google/Apple) num nome válido: remove o que não é
 * permitido; se não sobrar nada, usa o `fallback` (também limpo) ou "User".
 */
export function toPersonName(value: string | undefined, fallback = ''): string {
  const clean = (text: string) =>
    text
      .replace(/[^\p{L}\p{M}'’ .-]/gu, ' ')
      .replace(/\.(?!\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[^\p{L}\p{M}]+/u, '')
      .trim()
      .slice(0, 120);
  return clean(value ?? '') || clean(fallback) || 'User';
}

/** Tamanho em BYTES (UTF-8) — o bcrypt ignora o que passa de 72 bytes, não de 72 caracteres. */
export function MaxBytes(max: number) {
  return ValidateBy({
    name: 'maxBytes',
    constraints: [max],
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
      defaultMessage: i18nValidationMessage('validation.passwordTooLong'),
    },
  });
}
