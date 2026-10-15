import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import Handlebars from 'handlebars';
import { basename, join } from 'path';
import { MailTemplate } from './mail.types';

interface LanguageTemplates {
  hbs: typeof Handlebars;
  layout: Handlebars.TemplateDelegate;
  cache: Map<string, Handlebars.TemplateDelegate>;
}

/**
 * Compila os templates Handlebars de src/mail/templates:
 *
 *   layouts/main.hbs        -> layout base, compartilhado (recebe o conteúdo em {{{body}}})
 *   partials/*.hbs          -> partials compartilhados ({{> button url=... label=...}})
 *   <idioma>/*.hbs          -> um arquivo por e-mail, por idioma (en/welcome.hbs, pt-BR/welcome.hbs)
 *   <idioma>/partials/*.hbs -> partials com texto (ex.: footer), por idioma
 *
 * Cada idioma tem sua própria instância do Handlebars (os partials de idioma não se misturam).
 */
@Injectable()
export class MailTemplateService {
  private readonly templatesDir = join(__dirname, 'templates');
  private readonly languages = new Map<string, LanguageTemplates>();

  /** Idiomas que têm pasta de templates. */
  get availableLanguages(): string[] {
    return readdirSync(this.templatesDir).filter(
      (entry) =>
        !['layouts', 'partials'].includes(entry) &&
        statSync(join(this.templatesDir, entry)).isDirectory(),
    );
  }

  render(template: MailTemplate, lang: string, context: Record<string, unknown>): string {
    const set = this.forLanguage(lang);
    let compiled = set.cache.get(template);
    if (!compiled) {
      compiled = this.compileFile(set.hbs, join(this.templatesDir, lang, `${template}.hbs`));
      set.cache.set(template, compiled);
    }
    const data = { ...context, lang };
    return set.layout({ ...data, body: compiled(data) });
  }

  /** Versão texto simples do HTML (fallback para clientes sem HTML). */
  toText(html: string): string {
    return html
      .replace(/<(head|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
      .replace(/<(br|\/p|\/h[1-6]|\/tr|\/li)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n\n')
      .trim();
  }

  private forLanguage(lang: string): LanguageTemplates {
    const cached = this.languages.get(lang);
    if (cached) return cached;

    if (!existsSync(join(this.templatesDir, lang))) {
      throw new Error(`Não há templates de e-mail para o idioma "${lang}"`);
    }
    const hbs = Handlebars.create();
    this.registerHelpers(hbs);
    this.registerPartials(hbs, join(this.templatesDir, 'partials'));
    this.registerPartials(hbs, join(this.templatesDir, lang, 'partials'));

    const set: LanguageTemplates = {
      hbs,
      layout: this.compileFile(hbs, join(this.templatesDir, 'layouts', 'main.hbs')),
      cache: new Map(),
    };
    this.languages.set(lang, set);
    return set;
  }

  private compileFile(hbs: typeof Handlebars, path: string): Handlebars.TemplateDelegate {
    if (!existsSync(path)) {
      throw new Error(`Template de e-mail não encontrado: ${path}`);
    }
    return hbs.compile(readFileSync(path, 'utf8'));
  }

  private registerPartials(hbs: typeof Handlebars, dir: string) {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.hbs'))) {
      hbs.registerPartial(basename(file, '.hbs'), readFileSync(join(dir, file), 'utf8'));
    }
  }

  private registerHelpers(hbs: typeof Handlebars) {
    hbs.registerHelper('year', () => new Date().getFullYear());
    hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
    hbs.registerHelper('upper', (value: string) => String(value ?? '').toUpperCase());
    // {{concat a b c}} — o último argumento é o objeto "options" do Handlebars, por isso o slice
    hbs.registerHelper('concat', (...args: unknown[]) => args.slice(0, -1).join(''));
  }
}
