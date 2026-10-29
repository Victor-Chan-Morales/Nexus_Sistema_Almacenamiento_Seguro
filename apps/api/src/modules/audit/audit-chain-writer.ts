import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { computeRecordHash } from './audit-hash';
import { AuditEvent, AuditActorType, AuditResult } from './entities/audit-event.entity';
import { AuditAction, AuditResource } from './audit.types';

/** Evento con identificadores ya fijados. Lo usan el registro directo y el worker del outbox. */
export interface ResolvedAuditEvent {
  eventId: string;
  organizationId: string;
  actorId: string;
  action: AuditAction;
  resourceType?: AuditResource;
  resourceId?: string;
  correlationId: string;
  /** Si falta, se fija dentro del bloqueo. El outbox lo recibe con el momento de captura. */
  occurredAt?: Date;
}

/**
 * Escribe un evento al final de la cadena de su organización. Debe llamarse dentro de una transacción.
 * No conoce el outbox ni el reintento: así `AuditService` y el worker la comparten sin depender uno del otro.
 */
@Injectable()
export class AuditChainWriter {
  async append(manager: EntityManager, event: ResolvedAuditEvent, options: { dedupe: boolean }): Promise<void> {
    // Serializa los eventos de la organización: la cadena no se bifurca.
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [event.organizationId]);

    // Con `dedupe`, un evento que ya se confirmó (el cliente vio el error, pero el INSERT sí llegó) no se duplica.
    if (options.dedupe && (await manager.exists(AuditEvent, { where: { eventId: event.eventId } }))) return;

    // El último evento es el de mayor chain_seq: no depende del reloj ni de un UUID aleatorio.
    const last = await manager.findOne(AuditEvent, {
      where: { organizationId: event.organizationId },
      select: { recordHash: true, chainSeq: true },
      order: { chainSeq: 'DESC' },
    });

    // Sin occurredAt explícito, se fija dentro del bloqueo para que el orden temporal coincida con la cadena.
    const fields = {
      eventId: event.eventId,
      organizationId: event.organizationId,
      actorType: AuditActorType.USER,
      actorId: event.actorId,
      actionType: event.action,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId ?? null,
      result: AuditResult.SUCCESS,
      correlationId: event.correlationId,
      occurredAt: event.occurredAt ?? new Date(),
      prevHash: last?.recordHash ?? null,
      chainSeq: String((last ? Number(last.chainSeq) : 0) + 1),
    };

    await manager.insert(AuditEvent, {
      ...fields,
      recordHash: computeRecordHash(fields),
    });
  }
}
