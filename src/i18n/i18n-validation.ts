import { BadRequestException } from '@nestjs/common';
import type { ValidationArguments, ValidationError } from 'class-validator';
import { TranslationArgs, TranslationKey } from './translations';

const PREFIX = 'i18n:';

/**
 * Parâmetros de cada constraint do class-validator -> placeholders da tradução.
 * Ex.: @MinLength(8) => { min: 8 } => "senha deve ter pelo menos {min} caracteres".
 */
const CONSTRAINT_ARGS: Record<string, (constraints: any[]) => TranslationArgs> = {
  minLength: ([min]) => ({ min }),
  maxLength: ([max]) => ({ max }),
  min: ([min]) => ({ min }),
  max: ([max]) => ({ max }),
  isEnum: ([, values]) => ({ values }),
  isIn: ([values]) => ({ values }),
};

/**
 * Use como `message` nos decorators do class-validator que têm parâmetros
 * (MinLength, MaxLength, Min, Max, IsEnum, IsIn) ou para trocar a chave padrão:
 *
 *   @MinLength(8, { message: i18nValidationMessage() })
 *   @Matches(/.../, { message: i18nValidationMessage('validation.strongPassword') })
 *
 * Decorators sem parâmetro (IsEmail, IsNotEmpty...) não precisam: a chave
 * `validation.<constraint>` é usada automaticamente.
 */
export function i18nValidationMessage(key?: TranslationKey) {
  return (args: ValidationArguments) =>
    PREFIX + JSON.stringify({ key, constraints: args.constraints ?? [] });
}

export interface ValidationIssue {
  field: string;
  key: string;
  args: TranslationArgs;
}

/** exceptionFactory do ValidationPipe: transforma os erros em chaves traduzíveis pelo filtro. */
export function i18nValidationExceptionFactory(errors: ValidationError[]) {
  return new BadRequestException({ key: 'errors.validation', issues: toIssues(errors) });
}

function toIssues(errors: ValidationError[], parent = ''): ValidationIssue[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;

    const own = Object.entries(error.constraints ?? {}).map(([constraint, message]) => {
      const encoded = message.startsWith(PREFIX)
        ? (JSON.parse(message.slice(PREFIX.length)) as { key?: string; constraints: any[] })
        : undefined;
      return {
        field,
        key: encoded?.key ?? `validation.${constraint}`,
        args: CONSTRAINT_ARGS[constraint]?.(encoded?.constraints ?? []) ?? {},
      };
    });

    return [...own, ...toIssues(error.children ?? [], field)];
  });
}
