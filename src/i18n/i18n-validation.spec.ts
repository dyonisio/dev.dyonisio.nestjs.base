import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  validateSync,
} from 'class-validator';
import { i18nValidationExceptionFactory, i18nValidationMessage } from './i18n-validation';

class AddressDto {
  @IsString()
  @MaxLength(9, { message: i18nValidationMessage() })
  zip: string;
}

class SampleDto {
  @IsEmail()
  email: string;

  @MinLength(8, { message: i18nValidationMessage() })
  @Matches(/\d/, { message: i18nValidationMessage('validation.strongPassword') })
  password: string;

  @IsEnum({ A: 'a', B: 'b' }, { message: i18nValidationMessage() })
  kind: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;
}

const issuesFor = (plain: object) => {
  const errors = validateSync(plainToInstance(SampleDto, plain));
  const exception = i18nValidationExceptionFactory(errors);
  return (exception.getResponse() as { issues: unknown[] }).issues;
};

describe('i18nValidationExceptionFactory', () => {
  it('gera BadRequestException com a chave errors.validation', () => {
    const exception = i18nValidationExceptionFactory([]);
    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getResponse()).toEqual({ key: 'errors.validation', issues: [] });
  });

  it('converte cada constraint em { field, key, args } — inclusive campos aninhados', () => {
    const issues = issuesFor({
      email: 'invalido',
      password: 'abc',
      kind: 'z',
      address: { zip: '1234567890' },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        // sem `message` customizada: chave padrão validation.<constraint>, sem args
        { field: 'email', key: 'validation.isEmail', args: {} },
        // com i18nValidationMessage(): parâmetros da regra viram placeholders nomeados
        { field: 'password', key: 'validation.minLength', args: { min: 8 } },
        // chave customizada
        { field: 'password', key: 'validation.strongPassword', args: {} },
        { field: 'kind', key: 'validation.isEnum', args: { values: ['a', 'b'] } },
        // aninhado: caminho com ponto
        { field: 'address.zip', key: 'validation.maxLength', args: { max: 9 } },
      ]),
    );
  });
});
