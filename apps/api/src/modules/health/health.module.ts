import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

/**
 * Módulo HEALTH
 * Responsable: Víctor (integración)
 *
 * Expone GET /api/health para verificar que la API, la base de datos
 * y SeaweedFS están funcionando correctamente.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
