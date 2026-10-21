import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AdminPlansController } from './admin-plans.controller';
import { Payment } from './entities/payment.entity';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
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
  imports: [TypeOrmModule.forFeature([Payment, Subscription, Plan]), UsersModule],
  controllers: [PaymentsController, AdminPlansController],
  providers: [PaymentsService, PaymentProviders, PlansService],
  exports: [PaymentsService, PaymentProviders, PlansService],
})
export class PaymentsModule {}
