import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditChainWriter } from './audit-chain-writer';
import { errorCode, isPermanentError } from './audit-error-code';
import { AuditOutboxService } from './audit-outbox.service';
import { AuditEventInput } from './audit.types';
import {
  AuditEventResponseDto,
  AuditEventsResponseDto,
  ListAuditEventsQueryDto,
} from './dto/list-audit-events.dto';
import { AuditActorType, AuditEvent } from './entities/audit-event.entity';

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
    // ck_audit_event_actor: actor_type = user ⇔ hay actor_id. Una combinación inválida fallaría siempre, también al
    // reintentarse desde el outbox: se descarta aquí, con constancia en el log y sin datos del evento ni del actor.
    const actorType = input.actorType ?? AuditActorType.USER;
    if ((actorType === AuditActorType.USER) !== (input.actorId !== undefined && input.actorId !== null)) {
      this.logger.error(
        `[AUDIT_INVALID_ACTOR] evento ${input.action} descartado: actorType=${actorType} no concuerda con actorId`,
      );
      return;
    }

    // Identificadores fijados antes del intento: el reintento usa exactamente los mismos.
    // `capturedAt` solo viaja al outbox; en la ruta directa la cadena fija `occurred_at` dentro del lock.
    const eventId = randomUUID();
    const correlationId = input.correlationId ?? randomUUID();
    const capturedAt = new Date();
    const event = {
      eventId,
      organizationId: input.organizationId,
      actorId: input.actorId,
      // Sin resolver: el escritor aplica los valores por defecto (user, success) al insertar y al reintentar.
      actorType: input.actorType,
      result: input.result,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      correlationId,
      safeReason: input.safeReason ?? null,
    };

    try {
      await this.dataSource.transaction((manager) => this.writer.append(manager, event, { dedupe: false }));
    } catch (error) {
      // Solo el código de error: el mensaje y los parámetros de pg pueden contener datos del evento.
      const code = errorCode(error);
      this.logger.error(`No se pudo registrar el evento de auditoría (código ${code}), se encola para reintento`);
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
    const toIso = (date: Date | string) => new Date(date).toISOString();
    const qb = this.dataSource
      .getRepository(AuditEvent)
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

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const events: AuditEventResponseDto[] = pageRows.map((e) => ({
      id: e.eventId,
      action: e.actionType,
      resourceType: e.resourceType ?? null,
      resourceId: e.resourceId ?? null,
      actorId: e.actorId ?? null,
      actorType: e.actorType,
      result: e.result,
      occurredAt: toIso(e.occurredAt),
    }));

    const nextBefore = hasMore ? toIso(pageRows[pageRows.length - 1].occurredAt) : null;

    return {
      events,
      nextBefore,
    };
  }
}
