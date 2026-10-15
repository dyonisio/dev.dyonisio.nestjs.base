import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../common/request-context/request-context';
import {
  interpolate,
  lookup,
  matchLanguage,
  parseAcceptLanguage,
  SUPPORTED_LANGUAGES,
  TranslationArgs,
  TranslationKey,
} from './translations';

/** Request com o idioma já resolvido pelo middleware. */
export interface I18nRequest extends Request {
  lang?: string;
}

@Injectable()
export class I18nService {
  /** Usado quando o cliente não envia Accept-Language ou pede um idioma não suportado. */
  readonly fallbackLanguage: string;
  readonly languages = SUPPORTED_LANGUAGES;

  constructor(config: ConfigService) {
    this.fallbackLanguage = matchLanguage(config.get<string>('app.fallbackLanguage')) ?? 'en';
  }

  t(key: TranslationKey, lang: string, args?: TranslationArgs): string {
    const template = lookup(lang, key) ?? lookup(this.fallbackLanguage, key) ?? key;
    return interpolate(template, args);
  }

  /** Verifica se a string é uma chave de tradução existente. */
  has(key: unknown): key is TranslationKey {
    return typeof key === 'string' && lookup(this.fallbackLanguage, key) !== undefined;
  }

  /** Nome amigável do campo ("password" -> "senha"); usa o próprio nome se não houver tradução. */
  field(name: string, lang: string): string {
    const last = name.split('.').pop() ?? name;
    return lookup(lang, `fields.${last}`) ?? name;
  }

  resolve(req: Request): string {
    for (const candidate of parseAcceptLanguage(req.headers['accept-language'])) {
      const lang = matchLanguage(candidate);
      if (lang) return lang;
    }
    return this.fallbackLanguage;
  }

  /** Middleware: resolve o idioma uma vez por requisição e devolve Content-Language. */
  middleware() {
    return (req: I18nRequest, res: Response, next: NextFunction) => {
      req.lang = this.resolve(req);
      RequestContext.set({ lang: req.lang });
      res.setHeader('Content-Language', req.lang);
      next();
    };
  }
}
