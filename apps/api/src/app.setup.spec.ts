import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configureApp } from './app.setup';
import { Logger } from 'nestjs-pino';
import { I18nService } from './i18n/i18n.service';

/** O comportamento completo do configureApp é exercitado pelos e2e; aqui, os ramos de configuração. */
describe('configureApp', () => {
  const build = (config: Record<string, unknown>) => {
    const express = { set: jest.fn() };
    const app = {
      get: (token: unknown) =>
        token === ConfigService
          ? { get: (key: string, def?: unknown) => config[key] ?? def }
          : token === Logger
            ? {}
            : new I18nService({ get: () => 'en' } as unknown as ConfigService),
      useLogger: jest.fn(),
      use: jest.fn(),
      setGlobalPrefix: jest.fn(),
      enableVersioning: jest.fn(),
      enableCors: jest.fn(),
      useGlobalPipes: jest.fn(),
      useGlobalInterceptors: jest.fn(),
      getHttpAdapter: () => ({ getInstance: () => express }),
    };
    configureApp(app as unknown as INestApplication);
    return { app, express };
  };

  it('TRUST_PROXY > 0 configura o "trust proxy" do Express (IP real atrás de load balancer)', () => {
    const { express } = build({ 'app.trustProxy': 2, 'swagger.enabled': false });
    expect(express.set).toHaveBeenCalledWith('trust proxy', 2);
  });

  it('TRUST_PROXY = 0 (padrão, Lambda) não confia em X-Forwarded-For', () => {
    const { express } = build({ 'swagger.enabled': false });
    expect(express.set).not.toHaveBeenCalled();
  });

  it('aplica logger, contexto da requisição, prefixo /api, CORS, helmet e idioma', () => {
    const { app } = build({ 'app.corsOrigin': ['https://app.com'], 'swagger.enabled': false });

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['https://app.com'],
      credentials: true, // o front web manda o cookie do refresh token
      exposedHeaders: ['Content-Language', 'X-Request-Id'],
    });
    expect(app.use).toHaveBeenCalledTimes(3); // contexto da requisição + helmet + i18n
    expect(app.useLogger).toHaveBeenCalled();
  });
});
