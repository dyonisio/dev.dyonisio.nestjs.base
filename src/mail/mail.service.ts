import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import { I18nService } from '../i18n/i18n.service';
import { matchLanguage, TranslationKey } from '../i18n/translations';
import { MAIL_QUEUE, MAIL_TRANSPORTER } from './mail.constants';
import { MailTemplateService } from './mail-template.service';
import {
  MailGlobalContext,
  MailJob,
  MailQueue,
  MailRecipient,
  MailTemplate,
  SendMailOptions,
} from './mail.types';

/** "maria.silva@x.com" -> "ma***@x.com": o log ajuda a rastrear sem expor o e-mail inteiro. */
export const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  return domain ? `${user.slice(0, 2)}***@${domain}` : '***';
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter,
    private readonly templates: MailTemplateService,
    private readonly config: ConfigService,
    private readonly i18n: I18nService,
    /** Presente quando MAIL_DELIVERY=sqs: os e-mails vão para a fila em vez de sair na hora. */
    @Optional() @Inject(MAIL_QUEUE) private readonly queue?: MailQueue | null,
  ) {}

  /**
   * Envio genérico e tipado, no idioma informado (padrão: FALLBACK_LANGUAGE).
   *  - MAIL_DELIVERY=sync: renderiza e envia agora.
   *  - MAIL_DELIVERY=sqs:  coloca na fila; o worker (mail-worker) renderiza e envia.
   * Retorna false (e loga) em caso de falha — um problema de e-mail não derruba o fluxo principal.
   */
  async send<T extends MailTemplate>(options: SendMailOptions<T>): Promise<boolean> {
    const job: MailJob<T> = {
      to: options.to,
      subject: options.subject,
      template: options.template,
      context: options.context,
      lang: this.resolveLang(options.lang),
    };

    if (!this.queue) return this.deliver(job);

    try {
      await this.queue.enqueue(job);
      this.logger.log(`E-mail "${job.template}" enfileirado para ${maskEmail(job.to)}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Falha ao enfileirar e-mail "${job.template}" para ${maskEmail(job.to)}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return false;
    }
  }

  /**
   * Renderiza e envia de fato. Usado direto (sync) e pelo worker da fila.
   * @param options.throwOnError o worker precisa que a falha "suba" para a mensagem
   *   voltar à fila e ser tentada de novo (e ir para a DLQ depois de várias falhas).
   */
  async deliver(job: MailJob, options: { throwOnError?: boolean } = {}): Promise<boolean> {
    try {
      const html = this.templates.render(job.template, job.lang, {
        ...this.globalContext(job.subject),
        ...job.context,
      });
      const info = await this.transporter.sendMail({
        from: this.config.get<string>('mail.from'),
        to: job.to,
        subject: job.subject,
        html,
        text: this.templates.toText(html),
      });
      this.logger.log(
        `E-mail "${job.template}" (${job.lang}) enviado para ${maskEmail(job.to)} (${info.messageId})`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Falha ao enviar e-mail "${job.template}" para ${maskEmail(job.to)}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      if (options.throwOnError) throw error;
      return false;
    }
  }

  // ---------- Helpers por template (no idioma salvo do usuário) ----------

  sendWelcome(user: MailRecipient) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('welcome', lang),
      template: MailTemplate.WELCOME,
      context: { name: user.name, loginUrl: `${this.frontendUrl}/login` },
    });
  }

  sendVerifyEmail(user: MailRecipient, verifyUrl: string, expiresInHours: number) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('verifyEmail', lang),
      template: MailTemplate.VERIFY_EMAIL,
      context: { name: user.name, verifyUrl, expiresInHours },
    });
  }

  sendForgotPassword(user: MailRecipient, resetUrl: string, expiresInMinutes: number) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('forgotPassword', lang),
      template: MailTemplate.FORGOT_PASSWORD,
      context: { name: user.name, resetUrl, expiresInMinutes },
    });
  }

  sendPasswordChanged(user: MailRecipient) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('passwordChanged', lang),
      template: MailTemplate.PASSWORD_CHANGED,
      context: { name: user.name, changedAt: this.formatDate(new Date(), lang) },
    });
  }

  sendRoleChanged(user: MailRecipient, oldRole: string, newRole: string) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('roleChanged', lang),
      template: MailTemplate.ROLE_CHANGED,
      context: {
        name: user.name,
        oldRole: this.roleLabel(oldRole, lang),
        newRole: this.roleLabel(newRole, lang),
      },
    });
  }

  /**
   * Conta criada por um admin. Com `invite`, leva o link para a pessoa criar a própria senha;
   * sem, só avisa que a conta existe. A senha NUNCA vai no e-mail.
   */
  sendAccountCreated(user: MailRecipient, invite: { url: string; expiresInDays: number } | null) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('accountCreated', lang),
      template: MailTemplate.ACCOUNT_CREATED,
      context: {
        name: user.name,
        loginUrl: `${this.frontendUrl}/login`,
        setPasswordUrl: invite?.url ?? null,
        expiresInDays: invite?.expiresInDays ?? null,
      },
    });
  }

  // ---------- Alertas de segurança ----------
  // Avisam o dono da conta de mudanças sensíveis: se não foi ele, dá tempo de reagir.

  /** Login de um dispositivo que a conta ainda não tinha usado. */
  sendNewLogin(user: MailRecipient, device: { description: string; ip: string | null }) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('newLogin', lang),
      template: MailTemplate.NEW_LOGIN,
      context: {
        name: user.name,
        when: this.formatDate(new Date(), lang),
        device: device.description,
        ip: device.ip ?? '—',
        securityUrl: this.securityUrl,
      },
    });
  }

  sendTwoFactorChanged(user: MailRecipient, enabled: boolean, options: { byAdmin?: boolean } = {}) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject(enabled ? 'twoFactorEnabled' : 'twoFactorDisabled', lang),
      template: MailTemplate.TWO_FACTOR_CHANGED,
      context: {
        name: user.name,
        enabled,
        byAdmin: !!options.byAdmin,
        when: this.formatDate(new Date(), lang),
        securityUrl: this.securityUrl,
      },
    });
  }

  sendSocialLinked(user: MailRecipient, provider: string) {
    const lang = this.resolveLang(user.locale);
    const label = provider.charAt(0).toUpperCase() + provider.slice(1);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('socialLinked', lang, { provider: label }),
      template: MailTemplate.SOCIAL_LINKED,
      context: {
        name: user.name,
        provider: label,
        when: this.formatDate(new Date(), lang),
        securityUrl: this.securityUrl,
      },
    });
  }

  /** Vai para o endereço ANTIGO (`user.email`), avisando qual é o novo. */
  sendEmailChanged(user: MailRecipient, newEmail: string) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('emailChanged', lang),
      template: MailTemplate.EMAIL_CHANGED,
      context: { name: user.name, newEmail, when: this.formatDate(new Date(), lang) },
    });
  }

  sendAccountDeleted(user: MailRecipient, purgeAt: Date) {
    const lang = this.resolveLang(user.locale);
    return this.send({
      to: user.email,
      lang,
      subject: this.subject('accountDeleted', lang),
      template: MailTemplate.ACCOUNT_DELETED,
      context: {
        name: user.name,
        purgeDate: purgeAt.toLocaleDateString(lang, {
          timeZone: this.config.get<string>('mail.timezone', 'America/Sao_Paulo'),
          dateStyle: 'long',
        }),
      },
    });
  }

  /** Idioma suportado mais próximo do pedido; senão, o idioma padrão. */
  private resolveLang(lang?: string | null): string {
    return matchLanguage(lang ?? undefined) ?? this.i18n.fallbackLanguage;
  }

  private subject(key: string, lang: string, args: Record<string, string> = {}): string {
    return this.i18n.t(`mail.subjects.${key}` as TranslationKey, lang, {
      appName: this.appName,
      ...args,
    });
  }

  /** Data e hora no fuso configurado (MAIL_TIMEZONE), no formato do idioma. */
  private formatDate(date: Date, lang: string): string {
    return date.toLocaleString(lang, {
      timeZone: this.config.get<string>('mail.timezone', 'America/Sao_Paulo'),
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  /** Tela de segurança da conta no front (sessões, 2FA, formas de login). */
  private get securityUrl() {
    return `${this.frontendUrl}/account/security`;
  }

  /** Nome amigável da role; uma role nova sem tradução aparece com o nome original. */
  private roleLabel(role: string, lang: string): string {
    const key = `roles.${role}`;
    return this.i18n.has(key) ? this.i18n.t(key, lang) : role;
  }

  private get appName() {
    return this.config.get<string>('app.name', 'NestJS Base API');
  }

  private get frontendUrl() {
    return this.config.get<string>('app.frontendUrl', '');
  }

  private globalContext(subject: string): MailGlobalContext {
    return {
      appName: this.appName,
      appUrl: this.config.get<string>('app.url', ''),
      frontendUrl: this.frontendUrl,
      supportEmail: this.config.get<string>('mail.supportEmail', ''),
      subject,
    };
  }
}
