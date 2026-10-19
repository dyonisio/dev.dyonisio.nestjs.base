import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check', description: 'Checks the API and the database.' })
  @ApiOkResponse({
    schema: { example: { status: 'ok', database: 'up', timestamp: '2026-01-01T00:00:00.000Z' } },
  })
  @ApiServiceUnavailableResponse({
    description: 'Database unreachable',
    schema: { example: { status: 'error', database: 'down' } },
  })
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up', timestamp: new Date().toISOString() };
  }
}
