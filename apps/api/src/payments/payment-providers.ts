import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { deriveSecret } from '../common/crypto/derive-secret';
import { AbacatePayProvider } from './providers/abacatepay.provider';
import { InfinitePayProvider } from './providers/infinitepay.provider';
import type { PaymentProvider, ProviderId } from './providers/payment-provider';
import { StripeProvider } from './providers/stripe.provider';

export interface PaymentsConfig {
  providers: string[];
  stripe: { secretKey?: string; webhookSecret?: string };
  infinitepay: { handle?: string };
  abacatepay: { apiKey?: string; webhookSecret?: string };
}

/**
 * As plataformas ligadas em PAYMENT_PROVIDERS (ex.: "stripe,abacatepay"), na ordem em que
 * aparecem. Uma ligada sem as chaves dela fica de fora, com um aviso no log.
 */
@Injectable()
export class PaymentProviders {
  private readonly logger = new Logger('Payments');
  private readonly enabled = new Map<ProviderId, PaymentProvider>();

  constructor(config: ConfigService) {
    const cfg = config.get<PaymentsConfig>('payments');
    const jwtSecret = config.get<string>('jwt.secret', '');
    for (const id of cfg?.providers ?? []) {
      const provider = this.build(id, cfg!, jwtSecret);
      if (provider) this.enabled.set(provider.id, provider);
    }
  }

  all(): PaymentProvider[] {
    return [...this.enabled.values()];
  }

  get(id: string): PaymentProvider | undefined {
    return this.enabled.get(id as ProviderId);
  }

  private build(id: string, cfg: PaymentsConfig, jwtSecret: string): PaymentProvider | null {
    const missing = (keys: string) => {
      this.logger.warn(`${id} está em PAYMENT_PROVIDERS, mas falta ${keys}: ficou desligado`);
      return null;
    };
    switch (id) {
      case 'stripe':
        if (!cfg.stripe.secretKey || !cfg.stripe.webhookSecret) {
          return missing('STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET');
        }
        return new StripeProvider({
          secretKey: cfg.stripe.secretKey,
          webhookSecret: cfg.stripe.webhookSecret,
        });
      case 'infinitepay': {
        if (!cfg.infinitepay.handle) return missing('INFINITEPAY_HANDLE');
        // código de cada compra na URL do webhook (o da InfinitePay não vem assinado)
        const key = deriveSecret(jwtSecret, 'infinitepay-webhook');
        return new InfinitePayProvider({
          handle: cfg.infinitepay.handle.replace(/^\$/, ''),
          tokenFor: (paymentId) => createHmac('sha256', key).update(paymentId).digest('base64url'),
        });
      }
      case 'abacatepay':
        if (!cfg.abacatepay.apiKey || !cfg.abacatepay.webhookSecret) {
          return missing('ABACATEPAY_API_KEY e ABACATEPAY_WEBHOOK_SECRET');
        }
        return new AbacatePayProvider({
          apiKey: cfg.abacatepay.apiKey,
          webhookSecret: cfg.abacatepay.webhookSecret,
        });
      default:
        this.logger.warn(`Plataforma de pagamento desconhecida em PAYMENT_PROVIDERS: "${id}"`);
        return null;
    }
  }
}
