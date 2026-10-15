/**
 * Entrypoint da Lambda `maintenance` (agendada pelo EventBridge, ver serverless.yml)
 * e do comando `npm run maintenance` (run-maintenance.ts).
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { MaintenanceAppModule } from './maintenance-app.module';
import { MaintenanceReport, MaintenanceService } from './maintenance.service';

export async function handler(): Promise<MaintenanceReport> {
  // Roda poucas vezes por dia: sobe, executa e fecha (não deixa conexão aberta no banco)
  const app = await NestFactory.createApplicationContext(MaintenanceAppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  try {
    const report = await app.get(MaintenanceService).run();
    // Uma tarefa que falhou faz a execução falhar: aparece no alarme de erros da Lambda
    const failed = Object.entries(report).filter(([, r]) => typeof r === 'object');
    if (failed.length) {
      throw new Error(`Manutenção com falhas: ${failed.map(([name]) => name).join(', ')}`);
    }
    return report;
  } finally {
    await app.close();
  }
}
