import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = configureApp(
    await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true }),
  );
  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);

  app.enableShutdownHooks();
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API:     http://localhost:${port}/api`);
  if (config.get<boolean>('swagger.enabled')) {
    logger.log(`Swagger: http://localhost:${port}/docs`);
  }
}

void bootstrap();
