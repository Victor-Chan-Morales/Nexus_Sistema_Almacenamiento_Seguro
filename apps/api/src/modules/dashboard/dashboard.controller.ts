import { Controller, ForbiddenException, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DashboardService } from './dashboard.service';

/**
 * DashboardController
 *
 * GET /api/dashboard → organización, plan vigente, bytes usados y límite en bytes (requiere JWT)
 */
@Controller('dashboard')
@UseGuards(AuthGuard('jwt'))
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getSummary(@Request() req) {
    const { organizationId, organizationName } = req.user;
    if (!organizationId || !organizationName) {
      throw new ForbiddenException('La sesión no tiene una organización activa válida');
    }
    return this.dashboardService.getSummary(organizationName, organizationId);
  }
}
