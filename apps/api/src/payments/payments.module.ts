import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AdminBillingController } from './admin-billing.controller';
import { AdminPlansController } from './admin-plans.controller';
import { Grant } from './entities/grant.entity';
import { Payment } from './entities/payment.entity';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { GrantsService } from './grants.service';
import { PaymentProviders } from './payment-providers';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PlansService } from './plans.service';

/**
 * Pagamentos (exemplo): planos (editados em /admin/plans), checkout em Stripe / InfinitePay / AbacatePay e assinaturas.
 * Ligue as plataformas em PAYMENT_PROVIDERS; sem nenhuma, as rotas respondem "pagamentos
 * desligados". Veja docs/PAYMENTS.md.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment, Subscription, Plan, Grant]), UsersModule],
  // AdminBilling (users/:id/...) DEPOIS do PaymentsController (users/me/...): o "me" nunca vira :id
  controllers: [PaymentsController, AdminPlansController, AdminBillingController],
  providers: [PaymentsService, PaymentProviders, PlansService, GrantsService],
  exports: [PaymentsService, PaymentProviders, PlansService],
})
export class PaymentsModule {}
