import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { I18nRequest, I18nService } from './i18n.service';

const serviceWith = (fallback?: string) =>
  new I18nService({ get: () => fallback } as unknown as ConfigService);

const req = (acceptLanguage?: string) =>
  ({ headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {} }) as Request;

describe('I18nService', () => {
  const i18n = serviceWith('en');

  describe('fallbackLanguage', () => {
    it.each([
      ['pt-BR', 'pt-BR'],
      ['pt', 'pt-BR'],
      ['ja', 'en'], // não suportado -> en
      [undefined, 'en'], // não configurado -> en
    ])('FALLBACK_LANGUAGE=%s -> %s', (configured, expected) => {
      expect(serviceWith(configured).fallbackLanguage).toBe(expected);
    });
  });

  describe('t', () => {
    it('traduz e interpola', () => {
      expect(i18n.t('errors.tooManyRequests', 'pt-BR', { seconds: 5 })).toBe(
        'Muitas tentativas. Tente novamente em 5 segundos.',
      );
    });

    it('idioma desconhecido usa o idioma padrão', () => {
      expect(i18n.t('users.notFound', 'xx')).toBe('User not found');
    });

    it('chave inexistente devolve a própria chave (nunca quebra a resposta)', () => {
      expect(i18n.t('nao.existe' as never, 'en')).toBe('nao.existe');
    });
  });

  it('has reconhece apenas chaves-folha existentes', () => {
    expect(i18n.has('auth.invalidCredentials')).toBe(true);
    expect(i18n.has('auth')).toBe(false);
    expect(i18n.has('nao.existe')).toBe(false);
    expect(i18n.has(42)).toBe(false);
  });

  it('field traduz o nome do campo (inclusive aninhado) ou mantém o original', () => {
    expect(i18n.field('password', 'pt-BR')).toBe('senha');
    expect(i18n.field('user.email', 'pt-BR')).toBe('e-mail');
    expect(i18n.field('cpf', 'pt-BR')).toBe('cpf');
  });

  describe('resolve', () => {
    it.each([
      ['pt-BR', 'pt-BR'],
      ['fr, pt;q=0.9', 'pt-BR'],
      ['ja, de', 'en'],
      [undefined, 'en'],
    ])('Accept-Language "%s" -> %s', (header, expected) => {
      expect(i18n.resolve(req(header))).toBe(expected);
    });
  });

  it('middleware guarda o idioma na requisição e devolve Content-Language', () => {
    const request = req('pt-BR') as I18nRequest;
    const res = { setHeader: jest.fn() } as unknown as Response;
    const next = jest.fn();

    i18n.middleware()(request, res, next);

    expect(request.lang).toBe('pt-BR');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Language', 'pt-BR');
    expect(next).toHaveBeenCalled();
  });
});
