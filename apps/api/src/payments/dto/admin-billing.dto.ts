import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { i18nValidationMessage } from '../../i18n/i18n-validation';
import type { Grant } from '../entities/grant.entity';
import { GrantDto, PaymentDto, SubscriptionDto } from './payments.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** period_end e now: só cancelar; now_refund: cancelar agora e devolver a última cobrança. */
export const ADMIN_CANCEL_MODES = ['period_end', 'now', 'now_refund'] as const;
export type AdminCancelMode = (typeof ADMIN_CANCEL_MODES)[number];

export class AdminGrantDto extends GrantDto {
  @ApiProperty()
  reason: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  grantedById: string | null;

  static fromGrant(g: Grant): AdminGrantDto {
    return { ...GrantDto.from(g), reason: g.reason, grantedById: g.grantedById };
  }
}

export class AdminPaymentDto extends PaymentDto {
  @ApiProperty({
    enum: ['api', 'manual'],
    nullable: true,
    type: String,
    description:
      'api: refunded through the platform from here; manual: refund it on the platform panel/app, then record it here; null: cannot be refunded',
  })
  refund: 'api' | 'manual' | null;
}

export class AdminSubscriptionDto extends SubscriptionDto {
  @ApiProperty({
    type: [String],
    enum: ADMIN_CANCEL_MODES,
    description: 'How the admin can cancel it on this platform (empty: already canceled)',
  })
  cancelOptions: AdminCancelMode[];
}

/** O plano de um usuário, como o admin vê: com o que dá para fazer em cada item. */
export class AdminBillingDto {
  @ApiProperty({ enum: ['free', 'pro'] })
  plan: 'free' | 'pro';

  @ApiProperty()
  lifetime: boolean;

  @ApiProperty({ type: AdminGrantDto, nullable: true })
  grant: AdminGrantDto | null;

  @ApiProperty({ type: AdminSubscriptionDto, nullable: true })
  subscription: AdminSubscriptionDto | null;

  @ApiProperty({ type: [AdminPaymentDto], description: 'Most recent first' })
  payments: AdminPaymentDto[];
}

export class AdminCancelSubscriptionDto {
  @ApiProperty({ enum: ADMIN_CANCEL_MODES })
  @IsIn(ADMIN_CANCEL_MODES, { message: i18nValidationMessage() })
  mode: AdminCancelMode;
}

export class AdminRefundDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Shown on the platform, when it keeps one' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: i18nValidationMessage() })
  @Transform(trim)
  reason?: string;
}

export class GiveGrantDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 24,
    description: 'Months from today (or from the end of the current courtesy). Send this or endsAt',
  })
  @IsOptional()
  @IsInt()
  @Min(1, { message: i18nValidationMessage() })
  @Max(24, { message: i18nValidationMessage() })
  months?: number;

  @ApiPropertyOptional({ format: 'date-time', description: 'End date. Send this or months' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiProperty({ maxLength: 200, example: 'Compensation for the outage on Oct 20' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: i18nValidationMessage() })
  @Transform(trim)
  reason: string;
}
