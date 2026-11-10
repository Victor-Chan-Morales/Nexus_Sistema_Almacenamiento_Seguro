import {
  Controller,
  Get,
  Param,
  Request,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';
import {
  BillingOperationListResponse,
  BillingReceiptResponse,
  PlanCatalogResponse,
} from './billing.dto';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { RolesGuard } from '../iam/guards/roles.guard';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { priceUsd } from './billing.utils';

/**
 * BillingController
 *
 * GET /api/plans → Lista catálogo de planes aprobado oficial (público / autenticado)
 * GET /api/billing/operations → Historial de operaciones simuladas de la organización (solo tenant_admin)
 * GET /api/billing/operations/:id/receipt → Comprobante de una operación (SPEC-306, solo tenant_admin)
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
      priceMonthly: priceUsd(p),
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

  /**
   * SPEC-306: GET /api/billing/operations/:id/receipt. El organizationId sale de la sesión, nunca de la petición.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.TENANT_ADMIN)
  @Get('billing/operations/:id/receipt')
  async getReceipt(
    @Param('id') id: string,
    @Request() req: { user: AuthUser },
  ): Promise<BillingReceiptResponse> {
    const receipt = await this.billingService.getReceipt(req.user.organizationId, id);
    return {
      ...receipt,
      organizationName: req.user.organizationName,
      currency: 'USD',
      simulated: true,
    };
  }
}
