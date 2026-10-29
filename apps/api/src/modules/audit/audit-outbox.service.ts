import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OUTBOX_POLL_INTERVAL_MS, outboxBackoffSeconds, outboxHorizonPassed } from '../../common/outbox-policy';
import { AuditChainWriter, ResolvedAuditEvent } from './audit-chain-writer';
import { errorCode } from './audit-error-code';
import { AuditOutbox, AuditOutboxStatus } from './entities/audit-outbox.entity';
import { AuditAction, AuditResource } from './audit.types';

/** Arrendamiento de un lote. Holgado: si vence antes de terminar, el dedupe evita duplicar el evento. */
const LEASE_SECONDS = 300;
const BATCH_SIZE = 20;
/** Errores de Postgres que no mejoran reintentando: FK, NOT NULL, tipo de dato y CHECK. */
const PERMANENT_ERROR_CODES = new Set(['23503', '23502', '22P02', '23514']);

/**
 * Respaldo de eventos de auditoría que no entraron en la cadena (SPEC-401, issue #17).
 * `enqueue` se llama tras un fallo del INSERT directo. `dispatchDue` reintenta con espera creciente:
 * el evento conserva su `event_id`, así que reintentar nunca lo duplica ni altera la cadena.
 */
@Injectable()
export class AuditOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditOutboxService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly writer: AuditChainWriter,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchDue(), OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Nunca lanza: si tampoco se puede encolar, el evento se pierde y queda constancia en el log. */
  async enqueue(event: ResolvedAuditEvent & { occurredAt: Date }): Promise<void> {
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
      });
    } catch (error) {
      this.logger.error(`No se pudo encolar el evento de auditoría (código ${errorCode(error)})`);
    }
  }

  /** Reintenta los eventos pendientes cuyo momento de reintento ya llegó. Nunca lanza. */
  async dispatchDue(): Promise<void> {
    const now = new Date();
    let claimed: AuditOutbox[];
    try {
      claimed = await this.dataSource.transaction(async (manager) => {
        const rows = await manager
          .createQueryBuilder(AuditOutbox, 'o')
          .where('o.status = :pending', { pending: AuditOutboxStatus.PENDING })
          .andWhere('o.nextAttemptAt <= :now', { now })
          .andWhere('(o.lockedUntil IS NULL OR o.lockedUntil <= :now)', { now })
          .orderBy('o.nextAttemptAt', 'ASC')
          .limit(BATCH_SIZE)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();
        if (rows.length === 0) return [];

        // El arrendamiento evita que otra instancia tome el mismo evento mientras se procesa.
        const lockedUntil = new Date(now.getTime() + LEASE_SECONDS * 1000);
        await manager.update(AuditOutbox, { eventId: In(rows.map((row) => row.eventId)) }, { lockedUntil });
        return rows;
      });
    } catch (error) {
      this.logger.error(`No se pudo reclamar el outbox de auditoría (código ${errorCode(error)})`);
      return;
    }

    for (const row of claimed) {
      // Una caída de BD a mitad de una fila no debe tumbar el proceso: el arrendamiento vence y la fila se reintenta.
      try {
        await this.process(row);
      } catch (error) {
        this.logger.error(`No se pudo procesar el evento de auditoría ${row.eventId} (código ${errorCode(error)})`);
      }
    }
  }

  /** Estado para el health check. */
  async counts(): Promise<{ pending: number; dead: number }> {
    const repository = this.dataSource.getRepository(AuditOutbox);
    const [pending, dead] = await Promise.all([
      repository.countBy({ status: AuditOutboxStatus.PENDING }),
      repository.countBy({ status: AuditOutboxStatus.DEAD }),
    ]);
    return { pending, dead };
  }

  private async process(row: AuditOutbox): Promise<void> {
    // Se intenta siempre: una BD recuperada registra el evento aunque lleve más de 24 h capturado.
    try {
      // Con dedupe: si un intento anterior sí llegó a confirmarse, no se inserta de nuevo.
      await this.dataSource.transaction((manager) =>
        this.writer.append(manager, this.toResolved(row), { dedupe: true }),
      );
    } catch (error) {
      const code = errorCode(error);
      if (PERMANENT_ERROR_CODES.has(code)) {
        await this.markDead(row, code);
      } else {
        await this.scheduleRetry(row, code);
      }
      return;
    }

    // Si esta borrado falla después de confirmar el INSERT, el siguiente intento lo detiene el dedupe.
    await this.dataSource.manager.delete(AuditOutbox, { eventId: row.eventId });
  }

  private async scheduleRetry(row: AuditOutbox, code: string): Promise<void> {
    const attempts = row.attempts + 1;
    const backoffSeconds = outboxBackoffSeconds(attempts);
    const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

    // Solo un fallo transitorio cuenta contra el horizonte: si el próximo intento ya cae fuera de él, se abandona.
    if (outboxHorizonPassed(row.occurredAt, nextAttemptAt.getTime())) {
      await this.markDead(row, code);
      return;
    }
    await this.dataSource.manager.update(
      AuditOutbox,
      { eventId: row.eventId },
      { attempts, nextAttemptAt, lastError: code, lockedUntil: null },
    );
    this.logger.error(`Fallo al registrar el evento de auditoría ${row.eventId} (intento ${attempts}): ${code}`);
  }

  private async markDead(row: AuditOutbox, code: string): Promise<void> {
    await this.dataSource.manager.update(
      AuditOutbox,
      { eventId: row.eventId },
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
