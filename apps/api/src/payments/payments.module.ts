import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Payment } from './entities/payment.entity';
import { Subscription } from './entities/subscription.entity';
import { PaymentProviders } from './payment-providers';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Pagamentos (exemplo): planos, checkout em Stripe / InfinitePay / AbacatePay e assinaturas.
 * Ligue as plataformas em PAYMENT_PROVIDERS; sem nenhuma, as rotas respondem "pagamentos
 * desligados". Veja docs/PAYMENTS.md.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment, Subscription]), UsersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviders],
  exports: [PaymentsService, PaymentProviders],
})
export class PaymentsModule {}
