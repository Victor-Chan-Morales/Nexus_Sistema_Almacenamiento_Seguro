import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { AuditOutboxIndicator } from './audit-outbox.indicator';

/**
 * HealthController — endpoint de verificación del sistema.
 *
 * GET /api/health
 * Devuelve el estado del API, de la conexión a PostgreSQL y del outbox de auditoría (pendientes y abandonados).
 * Útil para Docker healthchecks y monitoreo básico.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly auditOutbox: AuditOutboxIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // Verifica la conexión a PostgreSQL
      () => this.db.pingCheck('postgresql'),
      () => this.auditOutbox.check(),
    ]);
  }
}
