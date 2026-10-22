import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { Authorize } from '../common/decorators/authorize.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/enums/permission.enum';
import { UuidParam } from '../common/pipes/uuid-param.pipe';
import {
  AdminBillingDto,
  AdminCancelSubscriptionDto,
  AdminRefundDto,
  GiveGrantDto,
} from './dto/admin-billing.dto';
import { PaymentsService } from './payments.service';

/**
 * O plano de um usuário, pelo admin: ver, cancelar a assinatura (com ou sem reembolso), reembolsar
 * uma compra e dar Pro de cortesia. Tudo responde o plano atualizado e fica na auditoria.
 *
 * Registrado DEPOIS do PaymentsController (users/me/billing...): o "me" nunca vira :id.
 */
@ApiTags('Payments')
@Controller('users/:id')
export class AdminBillingController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('billing')
  @Authorize(Permission.BILLING_MANAGE)
  @ApiOperation({
    summary: "A user's plan, subscription, payments and courtesy",
    description: 'Each item says what the admin can do with it. Permission: `billing:manage`.',
  })
  @ApiOkResponse({ type: AdminBillingDto })
  @ApiErrors([400, 'Invalid id'], [404, 'User not found'])
  billing(@Param('id', UuidParam) id: string) {
    return this.payments.adminBilling(id);
  }

  @Post('subscriptions/:subscriptionId/cancel')
  @Authorize(Permission.BILLING_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Cancel a user's subscription",
    description:
      '`period_end`: Pro until the end of the paid period; `now`: ends now; `now_refund`: ends now and refunds the last charge. Only the modes in `cancelOptions` work on that platform. Permission: `billing:manage`.',
  })
  @ApiOkResponse({ type: AdminBillingDto })
  @ApiErrors(
    [400, 'Invalid id, or the platform cannot cancel this way'],
    [404, 'Subscription not found'],
  )
  cancel(
    @CurrentUser('id') actorId: string,
    @Param('id', UuidParam) id: string,
    @Param('subscriptionId', UuidParam) subscriptionId: string,
    @Body() dto: AdminCancelSubscriptionDto,
  ) {
    return this.payments.adminCancel(id, subscriptionId, dto.mode, actorId);
  }

  @Post('payments/:paymentId/refund')
  @Authorize(Permission.BILLING_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Refund a user's one-time purchase",
    description:
      'Full refund through the platform when it has an API for it (`refund: api`). Otherwise (`manual`), refund it on the platform app first: this only records it. Either way the person loses what the purchase gave. Permission: `billing:manage`.',
  })
  @ApiOkResponse({ type: AdminBillingDto })
  @ApiErrors([400, 'Invalid id, or the payment cannot be refunded'], [404, 'Payment not found'])
  refund(
    @CurrentUser('id') actorId: string,
    @Param('id', UuidParam) id: string,
    @Param('paymentId', UuidParam) paymentId: string,
    @Body() dto: AdminRefundDto,
  ) {
    return this.payments.adminRefund(id, paymentId, dto.reason, actorId);
  }

  @Post('grant')
  @Authorize(Permission.BILLING_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Give courtesy Pro',
    description:
      'For `months` (from today, or from the end of the current courtesy) or until `endsAt`. Not for whoever has the lifetime plan or pays a subscription. Ends on its own at the date. Permission: `billing:manage`.',
  })
  @ApiOkResponse({ type: AdminBillingDto })
  @ApiErrors(
    [400, 'Invalid period, has the lifetime plan or pays a subscription'],
    [404, 'User not found'],
  )
  grant(
    @CurrentUser('id') actorId: string,
    @Param('id', UuidParam) id: string,
    @Body() dto: GiveGrantDto,
  ) {
    return this.payments.adminGrant(id, dto, actorId);
  }

  @Delete('grant')
  @Authorize(Permission.BILLING_MANAGE)
  @ApiOperation({
    summary: 'End the courtesy Pro now',
    description: 'Permission: `billing:manage`.',
  })
  @ApiOkResponse({ type: AdminBillingDto })
  @ApiErrors([400, 'Invalid id'], [404, 'User not found, or no active courtesy'])
  revokeGrant(@CurrentUser('id') actorId: string, @Param('id', UuidParam) id: string) {
    return this.payments.adminRevokeGrant(id, actorId);
  }
}
