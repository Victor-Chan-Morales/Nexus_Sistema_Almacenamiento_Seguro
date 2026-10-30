import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditChainWriter } from './audit-chain-writer';
import { errorCode, isPermanentError } from './audit-error-code';
import { AuditOutboxService } from './audit-outbox.service';
import { AuditEventInput } from './audit.types';
import {
  AuditEventsResponseDto,
  ListAuditEventsQueryDto,
} from './dto/list-audit-events.dto';
import { AuditEvent } from './entities/audit-event.entity';

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
    // Identificadores fijados antes del intento: el reintento usa exactamente los mismos.
    // `capturedAt` solo viaja al outbox; en la ruta directa la cadena fija `occurred_at` dentro del lock.
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
      await this.dataSource.transaction((manager) =>
        this.writer.append(manager, event, { dedupe: false }),
      );
    } catch (error) {
      // Solo el código de error: el mensaje y los parámetros de pg pueden contener datos del evento.
      const code = errorCode(error);
      this.logger.error(
        `No se pudo registrar el evento de auditoría (código ${code}), se encola para reintento`,
      );
      // `enqueue` no lanza: por eso no hace falta un segundo try aquí. Un fallo permanente no mejora
      // reintentando: se conserva directamente como `dead` para revisión.
      const queued = { ...event, occurredAt: capturedAt };
      if (isPermanentError(code)) await this.outbox.enqueue(queued, code);
      else await this.outbox.enqueue(queued);
    }
  }

  /**
   * SPEC-402: Consulta de eventos de auditoría por cursor para tenant_admin.
   * Filtra por organización y fecha previa si se especifica cursor 'before'.
   */
  async listEvents(
    organizationId: string,
    query: ListAuditEventsQueryDto,
  ): Promise<AuditEventsResponseDto> {
    const limit = query.limit ?? 50;
    const repo = this.dataSource.getRepository(AuditEvent);

    const qb = repo
      .createQueryBuilder('event')
      .where('event.organizationId = :organizationId', { organizationId })
      .orderBy('event.occurredAt', 'DESC')
      .addOrderBy('event.eventId', 'DESC')
      .take(limit + 1);

    if (query.before) {
      qb.andWhere('event.occurredAt < :before', {
        before: new Date(query.before),
      });
    }

    const events = await qb.getMany();
    const hasMore = events.length > limit;
    const itemsToReturn = hasMore ? events.slice(0, limit) : events;

    const nextBefore =
      hasMore && itemsToReturn.length > 0
        ? new Date(
            itemsToReturn[itemsToReturn.length - 1].occurredAt,
          ).toISOString()
        : null;

    const items = itemsToReturn.map((event) => ({
      id: event.eventId,
      action: event.actionType,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      actorId: event.actorId,
      result: event.result,
      occurredAt:
        event.occurredAt instanceof Date
          ? event.occurredAt.toISOString()
          : new Date(event.occurredAt).toISOString(),
    }));

    return {
      items,
      nextBefore,
    };
  }
}