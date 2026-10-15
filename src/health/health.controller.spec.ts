import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('banco respondendo -> ok', async () => {
    const controller = new HealthController({
      query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as DataSource);

    await expect(controller.check()).resolves.toMatchObject({ status: 'ok', database: 'up' });
  });

  it('banco fora do ar -> 503 (para o load balancer/monitoramento tirar a instância)', async () => {
    const controller = new HealthController({
      query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as DataSource);

    const error = await controller.check().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'error',
      database: 'down',
    });
  });
});
