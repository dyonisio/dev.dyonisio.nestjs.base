/**
 * Cada template em src/mail/templates/<nome>.hbs tem uma entrada aqui
 * com o contexto (variáveis) que ele espera. Isso dá tipagem forte ao MailService.send().
 *
 * Para criar um novo template:
 *   1. crie src/mail/templates/<nome>.hbs
 *   2. adicione o nome em MailTemplate e o contexto em MailTemplateContextMap
 *   3. (opcional) crie um helper no MailService, ex.: sendInvoice()
 */
export enum MailTemplate {
  WELCOME = 'welcome',
  VERIFY_EMAIL = 'verify-email',
  FORGOT_PASSWORD = 'forgot-password',
  PASSWORD_CHANGED = 'password-changed',
  ROLE_CHANGED = 'role-changed',
  ACCOUNT_CREATED = 'account-created',
  MAGIC_LINK = 'magic-link',
  // Alertas de segurança
  NEW_LOGIN = 'new-login',
  TWO_FACTOR_CHANGED = 'two-factor-changed',
  SOCIAL_LINKED = 'social-linked',
  PASSKEY_ADDED = 'passkey-added',
  EMAIL_CHANGED = 'email-changed',
  ACCOUNT_DELETED = 'account-deleted',
  // Plano e pagamentos
  PAYMENT_CONFIRMED = 'payment-confirmed',
  PAYMENT_REFUNDED = 'payment-refunded',
  SUBSCRIPTION_CANCELED = 'subscription-canceled',
  COURTESY_GIVEN = 'courtesy-given',
  COURTESY_ENDING = 'courtesy-ending',
}

export interface MailTemplateContextMap {
  [MailTemplate.PAYMENT_CONFIRMED]: {
    name: string;
    plan: string;
    amount: string;
    /** Assinatura (renova sozinha) ou compra única */
    recurring: boolean;
    billingUrl: string;
  };
  [MailTemplate.PAYMENT_REFUNDED]: {
    name: string;
    plan: string;
    amount: string;
    billingUrl: string;
  };
  [MailTemplate.SUBSCRIPTION_CANCELED]: {
    name: string;
    plan: string;
    /** Até quando continua Pro; null = terminou agora */
    endsAt: string | null;
    billingUrl: string;
  };
  [MailTemplate.COURTESY_GIVEN]: {
    name: string;
    endsAt: string;
    /** Já tinha cortesia e ela foi estendida */
    extended: boolean;
    billingUrl: string;
  };
  [MailTemplate.COURTESY_ENDING]: { name: string; endsAt: string; billingUrl: string };
  [MailTemplate.WELCOME]: { name: string; loginUrl: string };
  [MailTemplate.VERIFY_EMAIL]: { name: string; verifyUrl: string; expiresInHours: number };
  [MailTemplate.FORGOT_PASSWORD]: { name: string; resetUrl: string; expiresInMinutes: number };
  [MailTemplate.PASSWORD_CHANGED]: { name: string; changedAt: string };
  [MailTemplate.ROLE_CHANGED]: { name: string; oldRole: string; newRole: string };
  [MailTemplate.ACCOUNT_CREATED]: {
    name: string;
    loginUrl: string;
    /** Link para criar a senha (convite). null = o admin definiu a senha inicial */
    setPasswordUrl: string | null;
    expiresInDays: number | null;
  };
  [MailTemplate.MAGIC_LINK]: {
    name: string;
    loginUrl: string;
    expiresInMinutes: number;
    /** De onde o link foi pedido, para a pessoa reconhecer um pedido que não fez */
    device: string;
    ip: string;
  };
  [MailTemplate.NEW_LOGIN]: {
    name: string;
    when: string;
    device: string;
    ip: string;
    securityUrl: string;
  };
  [MailTemplate.TWO_FACTOR_CHANGED]: {
    name: string;
    enabled: boolean;
    byAdmin: boolean;
    when: string;
    securityUrl: string;
  };
  [MailTemplate.SOCIAL_LINKED]: {
    name: string;
    provider: string;
    when: string;
    securityUrl: string;
  };
  [MailTemplate.PASSKEY_ADDED]: {
    name: string;
    passkey: string;
    when: string;
    securityUrl: string;
  };
  [MailTemplate.EMAIL_CHANGED]: { name: string; newEmail: string; when: string };
  [MailTemplate.ACCOUNT_DELETED]: { name: string; purgeDate: string };
}

/** Variáveis disponíveis em todos os templates (inclusive no layout). */
export interface MailGlobalContext {
  appName: string;
  appUrl: string;
  frontendUrl: string;
  supportEmail: string;
  subject: string;
}

export interface SendMailOptions<T extends MailTemplate> {
  to: string;
  subject: string;
  template: T;
  context: MailTemplateContextMap[T];
  /** Idioma do e-mail (templates em templates/<idioma>/). Padrão: FALLBACK_LANGUAGE. */
  lang?: string;
}

/** Destinatário. `locale` é o idioma salvo do usuário (os e-mails saem nele). */
/** O nome do plano nos dois idiomas: o e-mail usa o da pessoa. */
export interface PlanNames {
  en: string;
  pt: string;
}

export interface MailRecipient {
  name: string;
  email: string;
  locale?: string | null;
}

/**
 * Um e-mail pronto para ser entregue: é o que vai para a fila (MAIL_DELIVERY=sqs)
 * e o que o worker recebe. Só dados serializáveis em JSON.
 */
export interface MailJob<T extends MailTemplate = MailTemplate> {
  to: string;
  subject: string;
  template: T;
  context: MailTemplateContextMap[T];
  lang: string;
}

/** Fila de envio (implementada com SQS em sqs-mail.queue.ts). */
export interface MailQueue {
  enqueue(job: MailJob): Promise<void>;
}
