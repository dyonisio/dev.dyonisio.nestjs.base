import { ConfigService } from '@nestjs/config';
import { createMailTransport } from './mail-transport.factory';

const mailConfig = (overrides: Record<string, unknown>) =>
  ({
    getOrThrow: () => ({
      transport: 'smtp',
      smtp: { host: 'smtp.test', port: 587, secure: false, user: undefined, pass: undefined },
      ses: { region: 'sa-east-1' },
      ...overrides,
    }),
  }) as unknown as ConfigService;

/** O Nodemailer guarda o transporte concreto em `.transporter`. */
const inner = (config: ConfigService) =>
  (createMailTransport(config) as unknown as { transporter: { name: string; options?: any } })
    .transporter;

describe('createMailTransport', () => {
  it('smtp sem usuário -> sem autenticação', () => {
    const transporter = inner(mailConfig({}));
    expect(transporter.name).toBe('SMTP');
    expect(transporter.options).toMatchObject({ host: 'smtp.test', port: 587, secure: false });
    expect(transporter.options.auth).toBeUndefined();
  });

  it('smtp com usuário -> autentica', () => {
    const transporter = inner(
      mailConfig({
        smtp: { host: 'smtp.test', port: 465, secure: true, user: 'apikey', pass: 'segredo' },
      }),
    );
    expect(transporter.options.auth).toEqual({ user: 'apikey', pass: 'segredo' });
  });

  it('ses -> Amazon SES via SDK, na região configurada', async () => {
    const transporter = inner(mailConfig({ transport: 'ses' })) as unknown as {
      name: string;
      ses: { sesClient: { config: { region: () => Promise<string> } } };
    };
    expect(transporter.name).toBe('SESTransport');
    await expect(transporter.ses.sesClient.config.region()).resolves.toBe('sa-east-1');
  });

  it('json -> não envia, apenas serializa (dev/testes)', () => {
    expect(inner(mailConfig({ transport: 'json' })).name).toBe('JSONTransport');
  });

  it('valor desconhecido cai no smtp (padrão)', () => {
    expect(inner(mailConfig({ transport: 'outro' })).name).toBe('SMTP');
  });
});
