import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { Authorize } from '../common/decorators/authorize.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/enums/permission.enum';
import { AdminPlanDto, CreatePlanDto, UpdatePlanDto } from './dto/plans.dto';
import { PlansService } from './plans.service';

/**
 * Planos à venda, pelo admin. Não há "apagar": compras e assinaturas apontam para o plano;
 * para tirar de venda, `active: false`.
 */
@ApiTags('Payments')
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @Authorize(Permission.PLANS_MANAGE)
  @ApiOperation({
    summary: 'All plans (on sale or not)',
    description: 'Permission: `plans:manage`.',
  })
  @ApiOkResponse({ type: [AdminPlanDto] })
  async list(): Promise<AdminPlanDto[]> {
    return (await this.plans.list()).map((p) => AdminPlanDto.from(p));
  }

  @Post()
  @Authorize(Permission.PLANS_MANAGE)
  @ApiOperation({
    summary: 'Create a plan',
    description: 'Recorded in the audit log. Permission: `plans:manage`.',
  })
  @ApiCreatedResponse({ type: AdminPlanDto })
  @ApiErrors([400, 'Validation failed'], [409, 'A plan with this id already exists'])
  async create(
    @CurrentUser('id') actorId: string,
    @Body() dto: CreatePlanDto,
  ): Promise<AdminPlanDto> {
    return AdminPlanDto.from(await this.plans.create(dto, actorId));
  }

  @Patch(':id')
  @Authorize(Permission.PLANS_MANAGE)
  @ApiOperation({
    summary: 'Change a plan (price, names, on sale)',
    description:
      'A new price applies to new purchases only: past payments keep theirs, and active subscriptions keep the price they had on the platform. Kind and interval cannot change. Recorded in the audit log. Permission: `plans:manage`.',
  })
  @ApiOkResponse({ type: AdminPlanDto })
  @ApiErrors([400, 'Validation failed'], [404, 'Plan not found'])
  async update(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<AdminPlanDto> {
    return AdminPlanDto.from(await this.plans.update(id, dto, actorId));
  }
}
