import { createHash } from 'node:crypto';
import { AuditActorType, AuditResult } from './entities/audit-event.entity';

/** Campos que entran en el hash. Incluye `prevHash` para encadenar eventos de la misma organización. */
export interface AuditHashFields {
  prevHash: string | null;
  chainSeq: string;
  eventId: string;
  organizationId: string;
  actorType: AuditActorType;
  actorId: string | null;
  actionType: string;
  resourceType: string | null;
  resourceId: string | null;
  safeReason: string | null;
  result: AuditResult;
  correlationId: string;
  occurredAt: Date;
}

/**
 * Función pura: el mismo evento siempre produce el mismo hash.
 * Se serializa con JSON, no con un separador: un valor que contenga `|` no puede confundirse con otro campo.
 */
export function computeRecordHash(fields: AuditHashFields): string {
  const payload = JSON.stringify([
    fields.prevHash ?? '',
    fields.chainSeq,
    fields.eventId,
    fields.organizationId,
    fields.actorType,
    fields.actorId ?? '',
    fields.actionType,
    fields.resourceType ?? '',
    fields.resourceId ?? '',
    fields.safeReason ?? '',
    fields.result,
    fields.correlationId,
    fields.occurredAt.toISOString(),
  ]);

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
