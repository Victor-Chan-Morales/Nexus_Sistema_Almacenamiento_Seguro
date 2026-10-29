import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OUTBOX_POLL_INTERVAL_MS, outboxBackoffSeconds } from '../../common/outbox-policy';
import { AuditChainWriter, ResolvedAuditEvent } from './audit-chain-writer';
import { errorCode, isPermanentError } from './audit-error-code';
import { AuditOutbox, AuditOutboxStatus } from './entities/audit-outbox.entity';
import { AuditAction, AuditResource } from './audit.types';

/**
 * Arrendamiento de una fila. Corto porque se reclama de una en una: si vence antes de terminar, el dedupe y el
 * borrado en la misma transacción hacen que un segundo procesador no duplique ni deje la fila a medias (I3, I4).
 */
const LEASE_SECONDS = 60;
const BATCH_SIZE = 20;
/** Pasado este tiempo desde la captura, cada fallo se marca como atascado. No se abandona nunca (I1). */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Respaldo de eventos de auditoría que no entraron en la cadena (SPEC-401, issue #17).
 * `enqueue` se llama tras un fallo del INSERT directo. `dispatchDue` reintenta con espera creciente:
 * el evento conserva su `event_id`, así que reintentar nunca lo duplica ni altera la cadena.
 * No hay horizonte de abandono: solo un error permanente deja un evento en `dead` (SPEC-401, I1).
 */
@Injectable()
export class AuditOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditOutboxService.name);
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly writer: AuditChainWriter,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  /** Espera el lote en curso para no procesar filas contra un DataSource que se está cerrando. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.inFlight;
  }

  /** Un lote a la vez: si el anterior sigue en marcha, este ciclo no se solapa con él. */
  private tick(): void {
    this.inFlight ??= this.dispatchDue().finally(() => {
      this.inFlight = undefined;
    });
  }

  /**
   * Nunca lanza: si tampoco se puede encolar, el evento se pierde y queda constancia en el log (I5).
   * `deadCode` encola directamente como `dead` un evento cuyo fallo ya se sabe permanente.
   */
  async enqueue(event: ResolvedAuditEvent & { occurredAt: Date }, deadCode?: string): Promise<void> {
    try {
      await this.dataSource.getRepository(AuditOutbox).insert({
        eventId: event.eventId,
        organizationId: event.organizationId,
        actorId: event.actorId,
        actionType: event.action,
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        correlationId: event.correlationId,
        occurredAt: event.occurredAt,
        ...(deadCode ? { status: AuditOutboxStatus.DEAD, lastError: deadCode } : {}),
      });
    } catch (error) {
      this.logger.error(`[AUDIT_EVENT_LOST] no se pudo encolar el evento de auditoría (código ${errorCode(error)})`);
      return;
    }
    if (deadCode) this.logger.error(`[AUDIT_OUTBOX_DEAD] evento ${event.eventId} abandonado (${deadCode})`);
  }

  /** Reintenta los eventos pendientes cuyo momento de reintento ya llegó. Nunca lanza. */
  async dispatchDue(): Promise<void> {
    for (let i = 0; i < BATCH_SIZE; i++) {
      const claim = await this.claimNext();
      if (!claim) return;
      const { row, lease } = claim;
      // Una caída de BD a mitad de una fila no debe tumbar el proceso: el arrendamiento vence y la fila se reintenta.
      try {
        await this.process(row, lease);
      } catch (error) {
        this.logger.error(`No se pudo procesar el evento de auditoría ${row.eventId} (código ${errorCode(error)})`);
      }
    }
  }

  /** Reclama una sola fila con su propio arrendamiento (I3). `undefined` si no hay ninguna o no se pudo reclamar. */
  private async claimNext(): Promise<{ row: AuditOutbox; lease: Date } | undefined> {
    const now = new Date();
    try {
      return await this.dataSource.transaction(async (manager) => {
        const row = await manager
          .createQueryBuilder(AuditOutbox, 'o')
          .where('o.status = :pending', { pending: AuditOutboxStatus.PENDING })
          .andWhere('o.nextAttemptAt <= :now', { now })
          .andWhere('(o.lockedUntil IS NULL OR o.lockedUntil <= :now)', { now })
          .orderBy('o.nextAttemptAt', 'ASC')
          .limit(1)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getOne();
        if (!row) return undefined;

        const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
        await manager.update(AuditOutbox, { eventId: row.eventId }, { lockedUntil: lease });
        return { row, lease };
      });
    } catch (error) {
      this.logger.error(`No se pudo reclamar el outbox de auditoría (código ${errorCode(error)})`);
      return undefined;
    }
  }

  private async process(row: AuditOutbox, lease: Date): Promise<void> {
    try {
      // Registro y baja del outbox en una sola transacción (I4). Con dedupe: si un intento anterior sí llegó a
      // confirmarse, no se inserta de nuevo y solo se da de baja la fila.
      await this.dataSource.transaction(async (manager) => {
        await this.writer.append(manager, this.toResolved(row), { dedupe: true });
        await manager.delete(AuditOutbox, { eventId: row.eventId });
      });
    } catch (error) {
      const code = errorCode(error);
      if (isPermanentError(code)) {
        await this.markDead(row, code, lease);
      } else {
        await this.scheduleRetry(row, code, lease);
      }
    }
  }

  private async scheduleRetry(row: AuditOutbox, code: string, lease: Date): Promise<void> {
    const attempts = row.attempts + 1;
    const backoffSeconds = outboxBackoffSeconds(attempts);
    const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

    // Solo si el arrendamiento sigue siendo el nuestro: si venció y otra instancia tomó la fila, no se pisa su estado.
    await this.dataSource.manager.update(
      AuditOutbox,
      { eventId: row.eventId, lockedUntil: lease },
      { attempts, nextAttemptAt, lastError: code, lockedUntil: null },
    );
    this.logger.error(`Fallo al registrar el evento de auditoría ${row.eventId} (intento ${attempts}): ${code}`);
    // Nunca se abandona (I1): pasado el plazo solo se marca para alertar a una persona.
    if (row.occurredAt.getTime() + STALE_AFTER_MS <= Date.now()) {
      this.logger.error(`[AUDIT_OUTBOX_STALE] evento ${row.eventId} sin registrar tras más de 24 h (${code})`);
    }
  }

  private async markDead(row: AuditOutbox, code: string, lease: Date): Promise<void> {
    await this.dataSource.manager.update(
      AuditOutbox,
      { eventId: row.eventId, lockedUntil: lease },
      { status: AuditOutboxStatus.DEAD, lastError: code, lockedUntil: null },
    );
    // Marcador fijo para alertar sobre el evento: el log no incluye datos del evento.
    this.logger.error(`[AUDIT_OUTBOX_DEAD] evento ${row.eventId} abandonado (${code})`);
  }

  private toResolved(row: AuditOutbox): ResolvedAuditEvent {
    return {
      eventId: row.eventId,
      organizationId: row.organizationId,
      actorId: row.actorId,
      action: row.actionType as AuditAction,
      resourceType: (row.resourceType ?? undefined) as AuditResource | undefined,
      resourceId: row.resourceId ?? undefined,
      correlationId: row.correlationId,
      occurredAt: row.occurredAt,
    };
  }
}
