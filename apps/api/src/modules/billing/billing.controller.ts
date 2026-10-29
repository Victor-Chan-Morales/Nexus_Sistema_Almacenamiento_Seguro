import {
  Controller,
  Get,
  Request,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';
import {
  BillingOperationListResponse,
  PlanCatalogResponse,
} from './billing.dto';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { RolesGuard } from '../iam/guards/roles.guard';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';

/**
 * BillingController
 *
 * GET /api/plans → Lista catálogo de planes aprobado oficial (público / autenticado)
 * GET /api/billing/operations → Historial de operaciones simuladas de la organización (solo tenant_admin)
 *
 * Aplica ApiExceptionFilter para garantizar el formato canónico:
 * { code, message, requestId }
 */
@Controller()
@UseFilters(ApiExceptionFilter)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  async listPlans(): Promise<PlanCatalogResponse> {
    const plans = await this.billingService.listPlans();
    const items = plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || 'Plan de almacenamiento seguro Nexus',
      priceMonthly: (p.priceCents || 0) / 100,
      storageLimitBytes: Number(p.storageLimitBytes),
      userLimit: p.maxMembers,
      validityDays: p.validityDays ?? null,
    }));
    return { items };
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.TENANT_ADMIN)
  @Get('billing/operations')
  async listOperations(
    @Request() req: { user: AuthUser },
  ): Promise<BillingOperationListResponse> {
    const items = await this.billingService.listOperations(req.user.organizationId);
    return { items };
  }
}
