import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { computeRecordHash } from './audit-hash';
import { AuditEvent, AuditActorType, AuditResult } from './entities/audit-event.entity';
import { AuditEventInput } from './audit.types';

/**
 * Registro síncrono de eventos de auditoría con cadena de hashes por organización.
 * Llamar después del commit de la operación principal, nunca dentro de su transacción.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Nunca lanza: un fallo de auditoría no debe romper la operación del usuario. */
  async logEvent(input: AuditEventInput): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        // Serializa los eventos de la organización: la cadena no se bifurca.
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          input.organizationId,
        ]);

        const last = await manager.findOne(AuditEvent, {
          where: { organizationId: input.organizationId },
          order: { occurredAt: 'DESC', eventId: 'DESC' },
        });

        // occurred_at se fija dentro del bloqueo para que el orden temporal coincida con la cadena.
        const fields = {
          eventId: randomUUID(),
          organizationId: input.organizationId,
          actorType: AuditActorType.USER,
          actorId: input.actorId,
          actionType: input.action,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          result: AuditResult.SUCCESS,
          correlationId: input.correlationId ?? randomUUID(),
          occurredAt: new Date(),
          prevHash: last?.recordHash ?? null,
        };

        await manager.insert(AuditEvent, {
          ...fields,
          recordHash: computeRecordHash(fields),
        });
      });
    } catch (error) {
      // Solo el código de error: el mensaje y los parámetros de pg pueden contener datos del evento.
      const code = (error as { code?: string }).code ?? 'UNKNOWN';
      this.logger.error(`No se pudo registrar el evento de auditoría (código ${code})`);
    }
  }
}
