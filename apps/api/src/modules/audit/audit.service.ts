import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditChainWriter } from './audit-chain-writer';
import { AuditOutboxService, errorCode } from './audit-outbox.service';
import { AuditEventInput } from './audit.types';

/**
 * Registro síncrono de eventos de auditoría con cadena de hashes por organización.
 * Llamar después del commit de la operación principal, nunca dentro de su transacción.
 * Si el INSERT falla, el evento pasa al outbox y un worker lo reintenta (issue #17).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly writer: AuditChainWriter,
    private readonly outbox: AuditOutboxService,
  ) {}

  /** Nunca lanza: un fallo de auditoría no debe romper la operación del usuario. */
  async logEvent(input: AuditEventInput): Promise<void> {
    // Identificadores y momento de captura fijados antes del intento: el reintento usa exactamente los mismos.
    const eventId = randomUUID();
    const correlationId = input.correlationId ?? randomUUID();
    const capturedAt = new Date();
    const event = {
      eventId,
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      correlationId,
    };

    try {
      await this.dataSource.transaction((manager) => this.writer.append(manager, event, { dedupe: false }));
    } catch (error) {
      // Solo el código de error: el mensaje y los parámetros de pg pueden contener datos del evento.
      this.logger.error(`No se pudo registrar el evento de auditoría (código ${errorCode(error)}), se encola para reintento`);
      try {
        await this.outbox.enqueue({ ...event, occurredAt: capturedAt });
      } catch (enqueueError) {
        this.logger.error(`No se pudo encolar el evento de auditoría (código ${errorCode(enqueueError)})`);
      }
    }
  }
}
