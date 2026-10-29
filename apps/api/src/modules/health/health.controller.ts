import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

/**
 * HealthController — endpoint de verificación del sistema.
 *
 * GET /api/health
 * Devuelve el estado de la conexión a PostgreSQL. No expone datos de auditoría: este endpoint no requiere
 * autenticación. Útil para Docker healthchecks y monitoreo básico.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // Verifica la conexión a PostgreSQL
      () => this.db.pingCheck('postgresql'),
    ]);
  }
}
