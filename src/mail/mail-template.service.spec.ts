import { readdirSync } from 'fs';
import { join } from 'path';
import { SUPPORTED_LANGUAGES } from '../i18n/translations';
import { MailTemplateService } from './mail-template.service';
import { MailTemplate, MailTemplateContextMap } from './mail.types';

const globals = {
  appName: 'Minha API',
  appUrl: 'http://api.test',
  frontendUrl: 'http://front.test',
  supportEmail: 'suporte@test.com',
  subject: 'Assunto',
};

const contexts: { [K in MailTemplate]: MailTemplateContextMap[K] } = {
  [MailTemplate.WELCOME]: { name: 'Maria', loginUrl: 'http://front.test/login' },
  [MailTemplate.VERIFY_EMAIL]: {
    name: 'Maria',
    verifyUrl: 'http://front.test/verify-email?token=abc',
    expiresInHours: 24,
  },
  [MailTemplate.FORGOT_PASSWORD]: {
    name: 'Maria',
    resetUrl: 'http://front.test/reset-password?token=abc',
    expiresInMinutes: 15,
  },
  [MailTemplate.PASSWORD_CHANGED]: { name: 'Maria', changedAt: '14/10/2026 10:00' },
  [MailTemplate.ROLE_CHANGED]: { name: 'Maria', oldRole: 'Usuário', newRole: 'Gerente' },
  [MailTemplate.NEW_LOGIN]: {
    name: 'Maria',
    when: '14/10/2026 10:00',
    device: 'Chrome · Windows',
    ip: '203.0.113.10',
    securityUrl: 'http://front.test/account/security',
  },
  [MailTemplate.TWO_FACTOR_CHANGED]: {
    name: 'Maria',
    enabled: true,
    byAdmin: false,
    when: '14/10/2026 10:00',
    securityUrl: 'http://front.test/account/security',
  },
  [MailTemplate.SOCIAL_LINKED]: {
    name: 'Maria',
    provider: 'Google',
    when: '14/10/2026 10:00',
    securityUrl: 'http://front.test/account/security',
  },
  [MailTemplate.EMAIL_CHANGED]: { name: 'Maria', newEmail: 'nova@x.com', when: '14/10/2026 10:00' },
  [MailTemplate.ACCOUNT_DELETED]: { name: 'Maria', purgeDate: '13 de novembro de 2026' },
};

const templatesDir = join(__dirname, 'templates');
const filesOf = (lang: string) =>
  readdirSync(join(templatesDir, lang))
    .filter((f) => f.endsWith('.hbs'))
    .sort();

describe('MailTemplateService', () => {
  const service = new MailTemplateService();
  const cases = SUPPORTED_LANGUAGES.flatMap((lang) =>
    Object.values(MailTemplate).map((template) => [lang, template] as const),
  );

  describe('templates por idioma', () => {
    it('existe uma pasta de templates para cada idioma suportado (e só para eles)', () => {
      expect(service.availableLanguages.sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    });

    it.each(SUPPORTED_LANGUAGES)('"%s" tem um arquivo para CADA template do enum', (lang) => {
      expect(filesOf(lang)).toEqual(
        Object.values(MailTemplate)
          .map((t) => `${t}.hbs`)
          .sort(),
      );
    });

    it.each(cases)('[%s] renderiza "%s" dentro do layout', (lang, template) => {
      const html = service.render(template, lang, { ...globals, ...contexts[template] });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain('Minha API'); // layout
      expect(html).toContain('suporte@test.com'); // partial footer (por idioma)
      expect(html).toContain('Maria'); // contexto do template
      expect(html).not.toMatch(/\{\{.*\}\}/); // nenhuma variável sobrando
    });

    it('o texto muda conforme o idioma', () => {
      const ctx = { ...globals, ...contexts[MailTemplate.FORGOT_PASSWORD] };
      expect(service.render(MailTemplate.FORGOT_PASSWORD, 'pt-BR', ctx)).toContain('15 minutos');
      expect(service.render(MailTemplate.FORGOT_PASSWORD, 'en', ctx)).toContain('15 minutes');
      expect(service.render(MailTemplate.WELCOME, 'en', ctx)).toContain('All rights reserved');
    });

    it('idioma sem templates gera erro claro', () => {
      expect(() => service.render(MailTemplate.WELCOME, 'ja', globals)).toThrow(
        'Não há templates de e-mail para o idioma "ja"',
      );
    });
  });

  it('inclui o link de redefinição de senha', () => {
    const html = service.render(MailTemplate.FORGOT_PASSWORD, 'pt-BR', {
      ...globals,
      ...contexts[MailTemplate.FORGOT_PASSWORD],
    });
    expect(html).toContain('href="http://front.test/reset-password?token&#x3D;abc"');
  });

  it('usa o helper concat no e-mail de senha alterada', () => {
    const html = service.render(MailTemplate.PASSWORD_CHANGED, 'en', {
      ...globals,
      ...contexts[MailTemplate.PASSWORD_CHANGED],
    });
    expect(html).toContain('href="http://front.test/forgot-password"');
  });

  it('gera uma versão em texto puro sem tags HTML', () => {
    const html = service.render(MailTemplate.WELCOME, 'pt-BR', {
      ...globals,
      ...contexts[MailTemplate.WELCOME],
    });
    const text = service.toText(html);

    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).toContain('Olá, Maria!');
    expect(text).toContain('Acessar minha conta (http://front.test/login)');
  });

  it('compila cada template uma única vez por idioma (cache)', () => {
    const fresh = new MailTemplateService(); // instância nova: cache vazio
    const context = { ...globals, ...contexts[MailTemplate.ROLE_CHANGED] };
    fresh.render(MailTemplate.ROLE_CHANGED, 'en', context); // 1ª vez: compila tudo

    const compile = jest.spyOn((fresh as any).forLanguage('en').hbs, 'compile');
    fresh.render(MailTemplate.ROLE_CHANGED, 'en', context);

    expect(compile).not.toHaveBeenCalled(); // 2ª vez: tudo vem do cache
    compile.mockRestore();
  });

  it('template inexistente gera erro claro', () => {
    expect(() => service.render('nao-existe' as MailTemplate, 'en', globals)).toThrow(
      /Template de e-mail não encontrado: .*nao-existe\.hbs/,
    );
  });

  it('helpers disponíveis nos templates: upper, eq, concat, year', () => {
    const hbs = (service as any).forLanguage('en').hbs as {
      compile: (t: string) => (c?: object) => string;
    };
    const render = (tpl: string, ctx?: object) => hbs.compile(tpl)(ctx);

    expect(render('{{upper name}}', { name: 'ana' })).toBe('ANA');
    expect(render('{{upper missing}}')).toBe('');
    expect(render('{{#if (eq a b)}}sim{{else}}não{{/if}}', { a: 1, b: 1 })).toBe('sim');
    expect(render('{{#if (eq a b)}}sim{{else}}não{{/if}}', { a: 1, b: 2 })).toBe('não');
    expect(render('{{concat "a" x "c"}}', { x: 'b' })).toBe('abc');
    expect(render('{{year}}')).toBe(String(new Date().getFullYear()));
  });
});
