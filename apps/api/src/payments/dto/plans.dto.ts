import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { i18nValidationMessage } from '../../i18n/i18n-validation';
import type { Plan } from '../entities/plan.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Um plano como o admin vê (todos os campos, nos dois idiomas). */
export class AdminPlanDto {
  @ApiProperty({ example: 'pro-monthly' })
  id: string;

  @ApiProperty({ enum: ['one_time', 'subscription'] })
  kind: string;

  @ApiProperty({ enum: ['month', 'year'], nullable: true, type: String })
  interval: string | null;

  @ApiProperty({ example: 2990, description: 'In cents' })
  amount: number;

  @ApiProperty({ example: 'BRL' })
  currency: string;

  @ApiProperty()
  nameEn: string;

  @ApiProperty()
  namePt: string;

  @ApiProperty()
  descriptionEn: string;

  @ApiProperty()
  descriptionPt: string;

  @ApiProperty({ description: 'On sale (shown on /billing)' })
  active: boolean;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static from(p: Plan): AdminPlanDto {
    // providerProducts fica de fora: é detalhe interno das plataformas
    return {
      id: p.id,
      kind: p.kind,
      interval: p.interval,
      amount: p.amount,
      currency: p.currency,
      nameEn: p.nameEn,
      namePt: p.namePt,
      descriptionEn: p.descriptionEn,
      descriptionPt: p.descriptionPt,
      active: p.active,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}

export class CreatePlanDto {
  @ApiProperty({
    example: 'pro-yearly',
    description: 'Stable id (lowercase letters, numbers and hyphens). Cannot be changed later.',
  })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: i18nValidationMessage('validation.planId') })
  id: string;

  @ApiProperty({ enum: ['one_time', 'subscription'], description: 'Cannot be changed later' })
  @IsIn(['one_time', 'subscription'], { message: i18nValidationMessage() })
  kind: 'one_time' | 'subscription';

  @ApiPropertyOptional({
    enum: ['month', 'year'],
    description: 'Required for subscriptions. Cannot be changed later',
  })
  @ValidateIf((o: CreatePlanDto) => o.kind === 'subscription')
  @IsIn(['month', 'year'], { message: i18nValidationMessage() })
  interval?: 'month' | 'year';

  @ApiProperty({ example: 2990, description: 'In cents (50 at least: the Stripe minimum)' })
  @IsInt()
  @Min(50, { message: i18nValidationMessage() })
  @Max(10_000_000, { message: i18nValidationMessage() })
  amount: number;

  @ApiProperty({ example: 'Pro, yearly', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80, { message: i18nValidationMessage() })
  @Transform(trim)
  nameEn: string;

  @ApiProperty({ example: 'Pro anual', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80, { message: i18nValidationMessage() })
  @Transform(trim)
  namePt: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: i18nValidationMessage() })
  @Transform(trim)
  descriptionEn?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: i18nValidationMessage() })
  @Transform(trim)
  descriptionPt?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0, { message: i18nValidationMessage() })
  @Max(1000, { message: i18nValidationMessage() })
  sortOrder?: number;
}

/** O tipo e o ciclo ficam fixos: compras e assinaturas antigas dependem deles. */
export class UpdatePlanDto extends PartialType(
  PickType(CreatePlanDto, [
    'amount',
    'nameEn',
    'namePt',
    'descriptionEn',
    'descriptionPt',
    'active',
    'sortOrder',
  ] as const),
) {}
