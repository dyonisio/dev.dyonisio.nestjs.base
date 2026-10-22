/**
 * Renderiza todos os templates de e-mail, em todos os idiomas, com dados de exemplo em
 * ./tmp/mail-preview/<idioma>/<template>.html — para abrir no navegador e ajustar o visual
 * sem disparar e-mails. Assuntos e nomes de roles vêm das traduções reais (src/i18n/locales).
 *
 * Uso: npm run mail:preview
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { interpolate, lookup } from '../src/i18n/translations';
import { MailTemplateService } from '../src/mail/mail-template.service';
import { MailTemplate, MailTemplateContextMap } from '../src/mail/mail.types';

const globals = {
  appName: 'NestJS Base',
  appUrl: 'http://localhost:3000',
  frontendUrl: 'http://localhost:5173',
  supportEmail: 'suporte@example.com',
};

// Token com tamanho real de um JWT, para validar a quebra de linha no layout
const LONG_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'.repeat(6);

const SUBJECT_KEYS: Record<MailTemplate, string> = {
  [MailTemplate.WELCOME]: 'welcome',
  [MailTemplate.VERIFY_EMAIL]: 'verifyEmail',
  [MailTemplate.FORGOT_PASSWORD]: 'forgotPassword',
  [MailTemplate.PASSWORD_CHANGED]: 'passwordChanged',
  [MailTemplate.ROLE_CHANGED]: 'roleChanged',
  [MailTemplate.ACCOUNT_CREATED]: 'accountCreated',
  [MailTemplate.MAGIC_LINK]: 'magicLink',
  [MailTemplate.NEW_LOGIN]: 'newLogin',
  [MailTemplate.TWO_FACTOR_CHANGED]: 'twoFactorDisabled',
  [MailTemplate.SOCIAL_LINKED]: 'socialLinked',
  [MailTemplate.PASSKEY_ADDED]: 'passkeyAdded',
  [MailTemplate.EMAIL_CHANGED]: 'emailChanged',
  [MailTemplate.ACCOUNT_DELETED]: 'accountDeleted',
  [MailTemplate.PAYMENT_CONFIRMED]: 'paymentConfirmed',
  [MailTemplate.PAYMENT_REFUNDED]: 'paymentRefunded',
  [MailTemplate.SUBSCRIPTION_CANCELED]: 'subscriptionCanceled',
  [MailTemplate.COURTESY_GIVEN]: 'courtesyGiven',
  [MailTemplate.COURTESY_ENDING]: 'courtesyEnding',
};

/** Dados de exemplo de cada template, no idioma informado. */
function samples(lang: string): { [K in MailTemplate]: MailTemplateContextMap[K] } {
  const day = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toLocaleDateString(lang, { dateStyle: 'long' });
  const pt = lang === 'pt-BR';
  return {
    [MailTemplate.PAYMENT_CONFIRMED]: {
      name: 'Maria Silva',
      plan: pt ? 'Pro mensal' : 'Pro, monthly',
      amount: pt ? 'R$ 29,90' : 'R$29.90',
      recurring: true,
      billingUrl: 'http://localhost:5173/billing',
    },
    [MailTemplate.PAYMENT_REFUNDED]: {
      name: 'Maria Silva',
      plan: pt ? 'Pro vitalício' : 'Pro, lifetime',
      amount: pt ? 'R$ 99,00' : 'R$99.00',
      billingUrl: 'http://localhost:5173/billing',
    },
    [MailTemplate.SUBSCRIPTION_CANCELED]: {
      name: 'Maria Silva',
      plan: pt ? 'Pro mensal' : 'Pro, monthly',
      endsAt: day(18),
      billingUrl: 'http://localhost:5173/billing',
    },
    [MailTemplate.COURTESY_GIVEN]: {
      name: 'Maria Silva',
      endsAt: day(61),
      extended: false,
      billingUrl: 'http://localhost:5173/billing',
    },
    [MailTemplate.COURTESY_ENDING]: {
      name: 'Maria Silva',
      endsAt: day(3),
      billingUrl: 'http://localhost:5173/billing',
    },
    [MailTemplate.WELCOME]: { name: 'Maria Silva', loginUrl: 'http://localhost:5173/login' },
    [MailTemplate.VERIFY_EMAIL]: {
      name: 'Maria Silva',
      verifyUrl: `http://localhost:5173/verify-email?token=${LONG_TOKEN}`,
      expiresInHours: 24,
    },
    [MailTemplate.FORGOT_PASSWORD]: {
      name: 'Maria Silva',
      resetUrl: `http://localhost:5173/reset-password?token=${LONG_TOKEN}`,
      expiresInMinutes: 15,
    },
    [MailTemplate.PASSWORD_CHANGED]: {
      name: 'Maria Silva',
      changedAt: new Date().toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }),
    },
    [MailTemplate.ROLE_CHANGED]: {
      name: 'Maria Silva',
      oldRole: lookup(lang, 'roles.user') ?? 'user',
      newRole: lookup(lang, 'roles.manager') ?? 'manager',
    },
    [MailTemplate.ACCOUNT_CREATED]: {
      name: 'Maria Silva',
      loginUrl: 'http://localhost:5173/login',
      setPasswordUrl: `http://localhost:5173/reset-password?token=${LONG_TOKEN}`,
      expiresInDays: 7,
    },
    [MailTemplate.MAGIC_LINK]: {
      name: 'Maria Silva',
      loginUrl: `http://localhost:5173/magic-link?token=${LONG_TOKEN}`,
      expiresInMinutes: 15,
      device: 'Chrome · Windows',
      ip: '203.0.113.10',
    },
    [MailTemplate.NEW_LOGIN]: {
      name: 'Maria Silva',
      when: new Date().toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }),
      device: 'Chrome · Windows',
      ip: '203.0.113.10',
      securityUrl: 'http://localhost:5173/account/security',
    },
    [MailTemplate.TWO_FACTOR_CHANGED]: {
      name: 'Maria Silva',
      enabled: false,
      byAdmin: true,
      when: new Date().toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }),
      securityUrl: 'http://localhost:5173/account/security',
    },
    [MailTemplate.SOCIAL_LINKED]: {
      name: 'Maria Silva',
      provider: 'Google',
      when: new Date().toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }),
      securityUrl: 'http://localhost:5173/account/security',
    },
    [MailTemplate.PASSKEY_ADDED]: {
      name: 'Maria Silva',
      passkey: 'Safari · iOS',
      when: new Date().toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }),
      securityUrl: 'http://localhost:5173/account/security',
    },
    [MailTemplate.EMAIL_CHANGED]: {
      name: 'Maria Silva',
      newEmail: 'maria.nova@example.com',
      when: new Date().toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }),
    },
    [MailTemplate.ACCOUNT_DELETED]: {
      name: 'Maria Silva',
      purgeDate: new Date(Date.now() + 30 * 86_400_000).toLocaleDateString(lang, {
        dateStyle: 'long',
      }),
    },
  };
}

// Um diretório por idioma: tmp/mail-preview/<idioma>/<template>.html
const templates = new MailTemplateService();
for (const lang of templates.availableLanguages) {
  const outDir = join(process.cwd(), 'tmp', 'mail-preview', lang);
  mkdirSync(outDir, { recursive: true });
  const data = samples(lang);

  for (const template of Object.values(MailTemplate)) {
    const subject = interpolate(lookup(lang, `mail.subjects.${SUBJECT_KEYS[template]}`) ?? '', {
      appName: globals.appName,
    });
    const file = join(outDir, `${template}.html`);
    writeFileSync(
      file,
      templates.render(template, lang, { ...globals, subject, ...data[template] }),
    );
    console.log(`✔ ${file}`);
  }
}
