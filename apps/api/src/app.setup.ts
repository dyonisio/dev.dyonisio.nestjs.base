import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { RequestContext } from './common/request-context/request-context';
import { ErrorResponseDto } from './common/dto/error-response.dto';
import { I18nService } from './i18n/i18n.service';
import { i18nValidationExceptionFactory } from './i18n/i18n-validation';

/**
 * Configuração compartilhada entre o servidor HTTP (main.ts),
 * a Lambda (lambda.ts) e os testes e2e — garante o mesmo comportamento nos três.
 */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(ConfigService);
  const i18n = app.get(I18nService);

  // Logs estruturados (pino) também para os logs internos do Nest
  app.useLogger(app.get(Logger));

  // PRIMEIRO middleware: cria o contexto da requisição (X-Request-Id, IP, user agent)
  app.use(RequestContext.middleware());

  // Headers de segurança (nosniff, frameguard, HSTS, CSP...). A CSP padrão do helmet
  // já é compatível com o Swagger UI, que só carrega scripts do próprio domínio.
  app.use(helmet());

  // Atrás de load balancer/proxy (ECS, Nginx...), informe quantos proxies existem para que
  // req.ip seja o IP real do cliente (usado no rate limiting). Na Lambda não é necessário:
  // o API Gateway entrega o IP de origem direto.
  const trustProxy = config.get<number>('app.trustProxy', 0);
  if (trustProxy > 0) {
    (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set(
      'trust proxy',
      trustProxy,
    );
  }

  // Rotas em /api/v1/... — uma versão nova (v2) pode conviver com a atual quando um
  // contrato precisar quebrar (apps mobile antigos continuam chamando a v1).
  // Rotas de infraestrutura (ex.: /api/health) são VERSION_NEUTRAL.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // credentials: o front web manda o cookie httpOnly do refresh token (auth/session-cookie.ts).
  // Com cookie, o navegador exige a origem exata: '*' vira "reflete a origem" — só em
  // desenvolvimento, porque em produção a validação do ambiente recusa CORS_ORIGIN=*.
  const corsOrigin = config.get<string | string[]>('app.corsOrigin', '*');
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin,
    credentials: true,
    exposedHeaders: ['Content-Language', 'X-Request-Id'],
  });

  // Resolve o idioma (Accept-Language) uma vez por requisição — usado pelo filtro de erros
  app.use(i18n.middleware());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: i18nValidationExceptionFactory,
    }),
  );
  // Aplica @Exclude() das entidades (ex.: senha nunca sai na resposta)
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  if (config.get<boolean>('swagger.enabled')) {
    setupSwagger(app, config, i18n);
  }

  return app;
}

function setupSwagger(app: INestApplication, config: ConfigService, i18n: I18nService) {
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app, config, i18n), {
    swaggerOptions: { persistAuthorization: true },
  });
}

/**
 * Contrato da API (OpenAPI). Também exportado para `openapi.json` (npm run openapi:export),
 * de onde o front gera tipos e cliente — veja docs/API_CLIENT.md.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  config: ConfigService = app.get(ConfigService),
  i18n: I18nService = app.get(I18nService),
): OpenAPIObject {
  const document = new DocumentBuilder()
    .setTitle(config.get<string>('app.name', 'NestJS Base'))
    .setDescription(
      [
        'API base with JWT authentication, revocable sessions (refresh tokens), 2FA, social sign-in and permission-based access control (roles `admin`, `manager`, `user`).',
        '',
        '**Versioning:** every route is under `/api/v1`. A breaking change ships as `/api/v2` while v1 keeps working.',
        '',
        '**Localized errors:** send the `Accept-Language` header (e.g. `pt-BR`, `en`) and every error message comes back in that language.',
        'Errors always have the shape `{ statusCode, code, message, errors?, requestId }` — use `code` in the client, it never changes.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addGlobalParameters({
      in: 'header',
      name: 'Accept-Language',
      required: false,
      description: 'Language for error messages',
      schema: { type: 'string', enum: i18n.languages, default: i18n.fallbackLanguage },
    })
    .build();

  return SwaggerModule.createDocument(app, document, { extraModels: [ErrorResponseDto] });
}
