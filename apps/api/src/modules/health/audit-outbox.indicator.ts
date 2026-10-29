import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { AuditOutboxService } from '../audit/audit-outbox.service';

/**
 * Informa cuántos eventos de auditoría esperan en el outbox y cuántos quedaron abandonados ('dead').
 * Nunca marca `down`: los eventos muertos requieren revisión, y reiniciar el contenedor no la resuelve.
 * Si la BD no responde, el ping de PostgreSQL ya falla en el mismo endpoint.
 */
@Injectable()
export class AuditOutboxIndicator extends HealthIndicator {
  constructor(private readonly outbox: AuditOutboxService) {
    super();
  }

  async check(key = 'audit_outbox'): Promise<HealthIndicatorResult> {
    const { pending, dead } = await this.outbox.counts();
    return this.getStatus(key, true, { pending, dead });
  }
}
