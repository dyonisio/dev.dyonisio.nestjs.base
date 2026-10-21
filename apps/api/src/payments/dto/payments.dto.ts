import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from '../../i18n/i18n-validation';
import type { Payment } from '../entities/payment.entity';
import type { Subscription } from '../entities/subscription.entity';
import { PROVIDER_IDS } from '../providers/payment-provider';

export class PlanDto {
  @ApiProperty({ example: 'pro-monthly' })
  id: string;

  @ApiProperty({ enum: ['one_time', 'subscription'] })
  kind: string;

  @ApiPropertyOptional({ enum: ['month', 'year'] })
  interval?: string;

  @ApiProperty({ example: 2990, description: 'In cents' })
  amount: number;

  @ApiProperty({ example: 'BRL' })
  currency: string;

  @ApiProperty({ example: 'Pro, monthly' })
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({
    type: [String],
    enum: PROVIDER_IDS,
    description: 'Enabled platforms that can charge this plan, in order of preference',
  })
  providers: string[];
}

export class ProviderInfoDto {
  @ApiProperty({ enum: PROVIDER_IDS })
  id: string;

  @ApiProperty({ type: [String], enum: ['card', 'pix', 'boleto'] })
  methods: string[];
}

export class PlansResponseDto {
  @ApiProperty({ type: [PlanDto] })
  plans: PlanDto[];

  @ApiProperty({ type: [ProviderInfoDto] })
  providers: ProviderInfoDto[];
}

export class CheckoutDto {
  @ApiProperty({ example: 'pro-monthly' })
  @IsString()
  @MaxLength(40, { message: i18nValidationMessage() })
  planId: string;

  @ApiPropertyOptional({
    enum: PROVIDER_IDS,
    description: 'Required only when more than one enabled platform can charge the plan',
  })
  @IsOptional()
  @IsIn(PROVIDER_IDS)
  provider?: string;
}

export class CheckoutResponseDto {
  @ApiProperty({ description: "The platform's payment page: send the person there" })
  url: string;

  @ApiProperty({ format: 'uuid' })
  paymentId: string;
}

export class ConfirmPaymentDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'The query parameters the platform added to the return URL (e.g. InfinitePay transaction_nsu and slug)',
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, string>;
}

export class PaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  planId: string;

  @ApiProperty({ enum: ['one_time', 'subscription'] })
  kind: string;

  @ApiProperty({ enum: PROVIDER_IDS })
  provider: string;

  @ApiProperty({ enum: ['pending', 'paid', 'failed', 'canceled', 'refunded'] })
  status: string;

  @ApiProperty({ description: 'In cents' })
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ type: Date, nullable: true })
  paidAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  static from(p: Payment): PaymentDto {
    const { id, planId, kind, provider, status, amount, currency, paidAt, createdAt } = p;
    return { id, planId, kind, provider, status, amount, currency, paidAt, createdAt };
  }
}

export class SubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  planId: string;

  @ApiProperty({ enum: PROVIDER_IDS })
  provider: string;

  @ApiProperty({ enum: ['active', 'past_due', 'canceled'] })
  status: string;

  @ApiProperty({ description: 'Canceled, but the paid period still counts until currentPeriodEnd' })
  cancelAtPeriodEnd: boolean;

  @ApiProperty({ type: Date, nullable: true })
  currentPeriodEnd: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  canceledAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  static from(s: Subscription): SubscriptionDto {
    const {
      id,
      planId,
      provider,
      status,
      cancelAtPeriodEnd,
      currentPeriodEnd,
      canceledAt,
      createdAt,
    } = s;
    return {
      id,
      planId,
      provider,
      status,
      cancelAtPeriodEnd,
      currentPeriodEnd,
      canceledAt,
      createdAt,
    };
  }
}

export class BillingDto {
  @ApiProperty({
    enum: ['free', 'pro'],
    description: 'pro = paid the lifetime plan, or has a subscription that is not canceled',
  })
  plan: 'free' | 'pro';

  @ApiProperty({
    description: 'Paid a one-time (lifetime) plan: Pro forever, nothing else to buy',
  })
  lifetime: boolean;

  @ApiProperty({
    type: SubscriptionDto,
    nullable: true,
    description: 'The current subscription, if any',
  })
  subscription: SubscriptionDto | null;

  @ApiProperty({ type: [PaymentDto], description: 'Most recent first' })
  payments: PaymentDto[];
}
