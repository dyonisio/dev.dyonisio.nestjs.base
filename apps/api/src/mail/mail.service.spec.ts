import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { I18nService } from '../i18n/i18n.service';
import { MAIL_QUEUE, MAIL_TRANSPORTER } from './mail.constants';
import { MailTemplateService } from './mail-template.service';
import { MailService } from './mail.service';
import { MailJob, MailTemplate } from './mail.types';

describe('MailService', () => {
  const transporter = { sendMail: jest.fn() };
  const config: Record<string, string> = {
    'app.name': 'Minha API',
    'app.url': 'http://api.test',
    'app.frontendUrl': 'http://front.test',
    'mail.from': 'Minha API <no-reply@test.com>',
    'mail.supportEmail': 'suporte@test.com',
    'mail.timezone': 'America/Sao_Paulo',
  };
  const configService = { get: (key: string, def?: unknown) => config[key] ?? def };

  const build = async (queue: { enqueue: jest.Mock } | null = null) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailService,
        MailTemplateService,
        { provide: MAIL_TRANSPORTER, useValue: transporter },
        { provide: MAIL_QUEUE, useValue: queue },
        { provide: ConfigService, useValue: configService },
        // idioma padrão "en" (FALLBACK_LANGUAGE)
        { provide: I18nService, useValue: new I18nService({ get: () => 'en' } as any) },
      ],
    }).compile();
    return moduleRef.get(MailService);
  };
  const sent = () => transporter.sendMail.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
    transporter.sendMail.mockResolvedValue({ messageId: 'msg-1' });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  describe('idioma do e-mail = idioma salvo do usuário', () => {
    it('usuário em português: assunto e corpo em português', async () => {
      const mail = await build();
      await mail.sendWelcome({ name: 'Maria', email: 'maria@test.com', locale: 'pt-BR' });

      expect(sent()).toMatchObject({
        from: 'Minha API <no-reply@test.com>',
        to: 'maria@test.com',
        subject: 'Bem-vindo(a) ao Minha API!',
      });
      expect(sent().html).toContain('<html lang="pt-BR">');
      expect(sent().text).toContain('Olá, Maria!');
    });

    it('usuário em inglês: assunto e corpo em inglês', async () => {
      const mail = await build();
      await mail.sendWelcome({ name: 'John', email: 'john@test.com', locale: 'en' });

      expect(sent().subject).toBe('Welcome to Minha API!');
      expect(sent().text).toContain('Hi, John!');
    });

    it.each([
      ['sem idioma salvo', null, 'en'],
      ['idioma não suportado', 'ja', 'en'],
      ['variação regional', 'pt', 'pt-BR'],
    ])('%s -> %s', async (_, locale, expected) => {
      const mail = await build();
      await mail.sendPasswordChanged({ name: 'X', email: 'x@test.com', locale });
      expect(sent().html).toContain(`<html lang="${expected}">`);
    });

    it('roles traduzidas no idioma do usuário; role nova sem tradução aparece crua', async () => {
      const mail = await build();
      await mail.sendRoleChanged(
        { name: 'M', email: 'm@test.com', locale: 'pt-BR' },
        'user',
        'manager',
      );
      expect(sent().html).toContain('Usuário');
      expect(sent().html).toContain('Gerente');

      transporter.sendMail.mockClear();
      await mail.sendRoleChanged(
        { name: 'M', email: 'm@test.com', locale: 'en' },
        'user',
        'auditor',
      );
      expect(sent().html).toContain('User');
      expect(sent().html).toContain('auditor');
    });

    it('cada helper usa o template e o assunto certos', async () => {
      const mail = await build();
      const user = { name: 'M', email: 'm@test.com', locale: 'en' };

      await mail.sendVerifyEmail(user, 'http://front.test/verify-email?token=t', 24);
      await mail.sendForgotPassword(user, 'http://front.test/reset-password?token=t', 15);

      const subjects = transporter.sendMail.mock.calls.map((c) => c[0].subject);
      expect(subjects).toEqual(['Confirm your email', 'Reset your password']);
    });
  });

  describe('falhas', () => {
    it('envio direto: retorna false (sem lançar) quando o transporte falha', async () => {
      const mail = await build();
      transporter.sendMail.mockRejectedValueOnce(new Error('SMTP fora do ar'));

      await expect(mail.sendPasswordChanged({ name: 'M', email: 'm@test.com' })).resolves.toBe(
        false,
      );
    });

    it('deliver com throwOnError (worker): a falha sobe para a mensagem voltar à fila', async () => {
      const mail = await build();
      transporter.sendMail.mockRejectedValueOnce(new Error('SES throttling'));
      const job: MailJob = {
        to: 'm@test.com',
        subject: 'S',
        template: MailTemplate.WELCOME,
        context: { name: 'M', loginUrl: 'x' },
        lang: 'en',
      };

      await expect(mail.deliver(job, { throwOnError: true })).rejects.toThrow('SES throttling');
    });
  });

  describe('com fila (MAIL_DELIVERY=sqs)', () => {
    it('não envia na hora: publica o job (com idioma e assunto já resolvidos) na fila', async () => {
      const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
      const mail = await build(queue);

      await expect(
        mail.sendForgotPassword(
          { name: 'M', email: 'm@test.com', locale: 'pt-BR' },
          'http://r',
          15,
        ),
      ).resolves.toBe(true);

      expect(transporter.sendMail).not.toHaveBeenCalled();
      expect(queue.enqueue).toHaveBeenCalledWith({
        to: 'm@test.com',
        lang: 'pt-BR',
        subject: 'Redefinição de senha',
        template: MailTemplate.FORGOT_PASSWORD,
        context: { name: 'M', resetUrl: 'http://r', expiresInMinutes: 15 },
      });
    });

    it('falha ao publicar na fila: retorna false (sem lançar)', async () => {
      const queue = { enqueue: jest.fn().mockRejectedValue(new Error('SQS indisponível')) };
      const mail = await build(queue);

      await expect(mail.sendWelcome({ name: 'M', email: 'm@test.com' })).resolves.toBe(false);
    });
  });
});
