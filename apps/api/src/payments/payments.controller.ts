import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UuidParam } from '../common/pipes/uuid-param.pipe';
import { i18nKey } from '../i18n/translations';
import {
  BillingDto,
  CheckoutDto,
  CheckoutResponseDto,
  ConfirmPaymentDto,
  PaymentDto,
  PlansResponseDto,
  SubscriptionDto,
} from './dto/payments.dto';
import { PaymentsService } from './payments.service';
import { PROVIDER_IDS } from './providers/payment-provider';

@ApiTags('Payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Get('payments/plans')
  @ApiOperation({
    summary: 'Plans for sale',
    description:
      'Each plan lists the enabled platforms (PAYMENT_PROVIDERS) that can charge it. With none, payments are off.',
  })
  @ApiOkResponse({ type: PlansResponseDto })
  plans(): Promise<PlansResponseDto> {
    return this.payments.plans();
  }

  @Post('payments/checkout')
  @Auth()
  @ApiOperation({
    summary: 'Start a purchase or subscription',
    description:
      'Creates the charge on the platform and returns its payment page. Send `provider` only when more than one platform can charge the plan. The purchase becomes `paid` only after the platform confirms it (webhook or `POST /payments/:id/confirm`).',
  })
  @ApiOkResponse({ type: CheckoutResponseDto })
  @ApiErrors(
    [400, 'Payments off, platform not available for the plan, choose a platform, or already owned'],
    [404, 'Plan not found'],
  )
  @HttpCode(HttpStatus.OK)
  checkout(@CurrentUser('id') userId: string, @Body() dto: CheckoutDto) {
    return this.payments.checkout(userId, dto.planId, dto.provider);
  }

  @Post('payments/:id/confirm')
  @Auth()
  @AllowUnverified()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check a purchase with the platform (back from the checkout)',
    description:
      'Asks the platform how the charge is. Send the query parameters the platform added to the return URL in `params`.',
  })
  @ApiOkResponse({ type: PaymentDto })
  @ApiErrors([400, 'Invalid id'], [404, 'Purchase not found'])
  confirm(
    @CurrentUser('id') userId: string,
    @Param('id', UuidParam) id: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.payments.confirm(userId, id, stringValues(dto.params));
  }

  @Get('users/me/billing')
  @Auth()
  @AllowUnverified()
  @ApiTags('Users')
  @ApiOperation({ summary: 'My plan, subscription and purchases' })
  @ApiOkResponse({ type: BillingDto })
  billing(@CurrentUser('id') userId: string) {
    return this.payments.billing(userId);
  }

  @Post('users/me/subscriptions/:id/cancel')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiTags('Users')
  @ApiOperation({
    summary: 'Cancel my subscription',
    description:
      'Stripe keeps it until the end of the paid period (`cancelAtPeriodEnd`); AbacatePay cancels right away.',
  })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiErrors([400, 'Invalid id'], [404, 'Subscription not found'])
  cancel(@CurrentUser('id') userId: string, @Param('id', UuidParam) id: string) {
    return this.payments.cancelSubscription(userId, id);
  }

  /**
   * Avisos das plataformas. Cada uma confere o seu (assinatura, segredo ou consulta à API dela)
   * sobre o corpo CRU da requisição: por isso a API sobe com `rawBody: true`.
   */
  @Public()
  @SkipThrottle()
  @Post('payments/webhooks/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'provider', enum: PROVIDER_IDS })
  @ApiOperation({
    summary: 'Webhook from a payment platform',
    description:
      'Configure this URL on the platform. Verified per platform; the body is never trusted on its own.',
  })
  @ApiErrors([400, 'Signature, secret or payload invalid'], [404, 'Platform not enabled'])
  async webhook(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Query() query: Record<string, unknown>,
  ): Promise<{ received: true }> {
    if (!req.rawBody) throw new BadRequestException(i18nKey('payments.invalidWebhook'));
    await this.payments.webhook(provider, { rawBody: req.rawBody, headers: req.headers, query });
    return { received: true };
  }
}

function stringValues(params: Record<string, unknown> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}
