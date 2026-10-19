import {
  Controller,
  Get,
  UseFilters,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { PlanCatalogResponse } from './billing.dto';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';

/**
 * BillingController
 *
 * GET /api/plans → Lista catálogo de planes aprobado oficial (público / autenticado)
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
}
