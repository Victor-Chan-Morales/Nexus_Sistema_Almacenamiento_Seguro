import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { errorCode } from '../audit/audit-error-code';
import { AuditOutboxService } from '../audit/audit-outbox.service';

/**
 * Informa cuántos eventos de auditoría esperan en el outbox y cuántos quedaron abandonados ('dead').
 * Nunca marca `down`: los eventos muertos requieren revisión, y reiniciar el contenedor no la resuelve.
 * Si la consulta falla, responde con un resultado estructurado en lugar de lanzar; el ping de PostgreSQL
 * del mismo endpoint ya informa si la BD está caída.
 */
@Injectable()
export class AuditOutboxIndicator extends HealthIndicator {
  constructor(private readonly outbox: AuditOutboxService) {
    super();
  }

  async check(key = 'audit_outbox'): Promise<HealthIndicatorResult> {
    try {
      const { pending, dead } = await this.outbox.counts();
      return this.getStatus(key, true, { pending, dead });
    } catch (error) {
      return this.getStatus(key, true, { available: false, error: errorCode(error) });
    }
  }
}
