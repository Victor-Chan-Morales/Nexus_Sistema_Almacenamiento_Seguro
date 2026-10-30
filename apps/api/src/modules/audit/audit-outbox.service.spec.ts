import { Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditChainWriter, ResolvedAuditEvent } from './audit-chain-writer';
import { AuditOutboxService } from './audit-outbox.service';
import { AuditAction, AuditResource } from './audit.types';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '66666666-6666-4666-8666-666666666666';
const CORRELATION_ID = '77777777-7777-4777-8777-777777777777';
const T0 = new Date('2026-10-29T12:00:00.000Z');
const MINUTE = 60_000;

const event: ResolvedAuditEvent & { occurredAt: Date } = {
  eventId: EVENT_ID,
  organizationId: ORG_ID,
  actorId: ACTOR_ID,
  action: AuditAction.FILE_DELETE,
  resourceType: AuditResource.FILE,
  resourceId: RESOURCE_ID,
  correlationId: CORRELATION_ID,
  occurredAt: T0,
};

const transient = () => Object.assign(new Error('conexión caída'), { code: '40P01' });
const permanent = () => Object.assign(new Error('FK'), { code: '23503' });

type OutboxRow = { eventId: string; nextAttemptAt: Date; lockedUntil?: Date | null; [column: string]: unknown };
type ChainRow = { eventId: string; occurredAt: Date; [column: string]: unknown };
type FakeDb = ReturnType<typeof createFakeDb>;
type TxCallback = Parameters<FakeDb['dataSource']['transaction']>[0];
type FakeManager = Parameters<TxCallback>[0];

/**
 * Fake en memoria de la BD: la tabla del outbox, la cadena de auditoría y fallos inyectables en el INSERT de la cadena.
 * Replica lo que usa el servicio: reclamo con lease, update por event_id, exists/findOne/insert de la cadena.
 */
function createFakeDb() {
  const outbox = new Map<string, OutboxRow>();
  const chain: ChainRow[] = [];
  const failures: Error[] = [];

  const idsOf = (criteria: { eventId: string | { value: string[] } }): string[] => {
    const value = criteria.eventId;
    return typeof value === 'string' ? [value] : value.value;
  };
  const update = async (
    _entity: unknown,
    criteria: { eventId: string | { value: string[] }; lockedUntil?: Date },
    values: Record<string, unknown>,
  ) => {
    for (const id of idsOf(criteria)) {
      const row = outbox.get(id);
      if (!row) continue;
      // Un criterio lockedUntil actúa como guarda: solo actualiza si el arrendamiento sigue siendo ese.
      if (criteria.lockedUntil && row.lockedUntil?.getTime() !== criteria.lockedUntil.getTime()) continue;
      Object.assign(row, values);
    }
  };
  const remove = async (_entity: unknown, criteria: { eventId: string }) => {
    outbox.delete(criteria.eventId);
  };

  const claimBuilder = () => {
    let now = T0;
    const api = {
      where: () => api,
      andWhere: (_sql: string, params: { now: Date }) => {
        now = params.now;
        return api;
      },
      orderBy: () => api,
      limit: () => api,
      setLock: () => api,
      setOnLocked: () => api,
      getOne: async () =>
        [...outbox.values()]
          .filter(
            (row) =>
              row.status === 'pending' &&
              row.nextAttemptAt.getTime() <= now.getTime() &&
              (row.lockedUntil == null || row.lockedUntil.getTime() <= now.getTime()),
          )
          .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
          .map((row) => ({ ...row }))[0] ?? null,
    };
    return api;
  };

  const manager = {
    createQueryBuilder: () => claimBuilder(),
    update,
    delete: remove,
    query: async () => undefined,
    exists: async (_entity: unknown, options: { where: { eventId: string } }) =>
      chain.some((row) => row.eventId === options.where.eventId),
    findOne: async (_entity: unknown, options: { where: { organizationId: string } }) =>
      chain
        .filter((row) => row.organizationId === options.where.organizationId)
        .reduce<ChainRow | null>(
          (max, row) => (!max || Number(row.chainSeq) > Number(max.chainSeq) ? row : max),
          null,
        ),
    insert: async (_entity: unknown, row: ChainRow) => {
      if (failures.length > 0) throw failures.shift();
      chain.push({ ...row });
    },
  };

  const dataSource = {
    // Con rollback: si el callback lanza, la cadena y el outbox vuelven a como estaban.
    transaction: async (callback: (m: typeof manager) => Promise<void> | Promise<unknown>) => {
      const chainBefore = chain.map((row) => ({ ...row }));
      const outboxBefore = [...outbox.entries()].map(([id, row]) => [id, { ...row }] as const);
      try {
        return await callback(manager);
      } catch (error) {
        chain.splice(0, chain.length, ...chainBefore);
        outbox.clear();
        outboxBefore.forEach(([id, row]) => outbox.set(id, row));
        throw error;
      }
    },
    manager: { update, delete: remove },
    getRepository: () => ({
      insert: async (row: OutboxRow) =>
        outbox.set(row.eventId, {
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          createdAt: new Date(),
          lastError: null,
          lockedUntil: null,
          ...row,
        }),
    }),
  };

  return { outbox, chain, failures, dataSource };
}

describe('AuditOutboxService — reintento de eventos de auditoría (issue #17)', () => {
  let db: ReturnType<typeof createFakeDb>;
  let service: AuditOutboxService;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    db = createFakeDb();
    service = new AuditOutboxService(db.dataSource as unknown as DataSource, new AuditChainWriter());
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('un fallo transitorio deja el evento pendiente; al reintentar sin fallo se registra y se borra del outbox', async () => {
    await service.enqueue(event);
    db.failures.push(transient());

    await service.dispatchDue();

    expect(db.outbox.get(EVENT_ID)).toMatchObject({ status: 'pending', attempts: 1, lastError: '40P01' });
    expect(db.chain).toHaveLength(0);

    jest.setSystemTime(new Date(T0.getTime() + 3 * MINUTE));
    await service.dispatchDue();

    expect(db.chain).toHaveLength(1);
    expect(db.chain[0]).toMatchObject({ eventId: EVENT_ID, correlationId: CORRELATION_ID, chainSeq: '1' });
    expect(db.outbox.size).toBe(0);
  });

  it('si el evento ya estaba en la cadena (el INSERT llegó pero el cliente vio error), no se duplica ni altera la cadena', async () => {
    await db.dataSource.transaction((m) => new AuditChainWriter().append(m as unknown as EntityManager, event, { dedupe: false }));
    await service.enqueue(event);

    await service.dispatchDue();

    expect(db.chain).toHaveLength(1);
    expect(db.chain[0].chainSeq).toBe('1');
    expect(db.outbox.size).toBe(0);
  });

  it('un error permanente pasa a dead de inmediato y registra el marcador fijo sin datos del evento', async () => {
    await service.enqueue(event);
    db.failures.push(permanent());

    await service.dispatchDue();

    expect(db.outbox.get(EVENT_ID)).toMatchObject({ status: 'dead', lastError: '23503' });
    const messages = loggerError.mock.calls.map((call) => call[0] as string);
    expect(messages.some((m) => m.startsWith('[AUDIT_OUTBOX_DEAD]') && m.includes('23503'))).toBe(true);
    expect(messages.join(' ')).not.toContain(ORG_ID);
  });

  it('con la BD sana, un evento de más de 24 h desde la captura se registra igualmente', async () => {
    await service.enqueue(event);
    jest.setSystemTime(new Date(T0.getTime() + 25 * 60 * MINUTE));

    await service.dispatchDue();

    expect(db.chain).toHaveLength(1);
    expect(db.chain[0]).toMatchObject({ eventId: EVENT_ID, occurredAt: T0 });
    expect(db.outbox.size).toBe(0);
  });

  it('superadas 24 h desde la captura, un fallo transitorio sigue pending y registra el marcador de atascado (I1)', async () => {
    await service.enqueue(event);
    db.failures.push(transient());
    jest.setSystemTime(new Date(T0.getTime() + 25 * 60 * MINUTE));

    await service.dispatchDue();

    expect(db.outbox.get(EVENT_ID)).toMatchObject({ status: 'pending', attempts: 1, lastError: '40P01' });
    const messages = loggerError.mock.calls.map((call) => call[0] as string);
    expect(messages.some((m) => m.startsWith('[AUDIT_OUTBOX_STALE]'))).toBe(true);
    expect(messages.some((m) => m.startsWith('[AUDIT_OUTBOX_DEAD]'))).toBe(false);
    expect(messages.join(' ')).not.toContain(ORG_ID);

    jest.setSystemTime(new Date(T0.getTime() + 25 * 60 * MINUTE + 3 * MINUTE));
    await service.dispatchDue();
    expect(db.chain).toHaveLength(1);
    expect(db.outbox.size).toBe(0);
  });

  it('antes de 24 h un fallo transitorio no registra el marcador de atascado', async () => {
    await service.enqueue(event);
    db.failures.push(transient());

    await service.dispatchDue();

    const messages = loggerError.mock.calls.map((call) => call[0] as string);
    expect(messages.some((m) => m.startsWith('[AUDIT_OUTBOX_STALE]'))).toBe(false);
  });

  it('la espera crece con cada intento y se topa en 30 minutos', async () => {
    await service.enqueue(event);
    const delays: number[] = [];

    for (let attempt = 1; attempt <= 8; attempt++) {
      db.failures.push(transient());
      jest.setSystemTime(new Date(T0.getTime() + attempt * 31 * MINUTE));
      await service.dispatchDue();
      delays.push(db.outbox.get(EVENT_ID)!.nextAttemptAt.getTime() - Date.now());
    }

    expect(delays[0]).toBe(2 * MINUTE);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[delays.length - 1]).toBe(30 * MINUTE);
    expect(db.outbox.get(EVENT_ID)!.attempts).toBe(8);
  });

  it('enqueue con código permanente guarda la fila como dead y registra el marcador', async () => {
    await service.enqueue(event, '23503');

    expect(db.outbox.get(EVENT_ID)).toMatchObject({ status: 'dead', lastError: '23503' });
    const messages = loggerError.mock.calls.map((call) => call[0] as string);
    expect(messages.some((m) => m.startsWith('[AUDIT_OUTBOX_DEAD]') && m.includes('23503'))).toBe(true);

    await service.dispatchDue();
    expect(db.chain).toHaveLength(0);
  });

  it('una fila dead recuperada con el re-drive documentado se registra en la cadena', async () => {
    await service.enqueue(event, '23503');
    Object.assign(db.outbox.get(EVENT_ID)!, { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lockedUntil: null });

    await service.dispatchDue();

    expect(db.chain).toHaveLength(1);
    expect(db.outbox.size).toBe(0);
  });

  it('enqueue nunca lanza: si no puede guardar, registra el código y termina', async () => {
    jest.spyOn(db.dataSource, 'getRepository').mockImplementationOnce(() => {
      throw new Error('caída');
    });

    await expect(service.enqueue(event)).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('[AUDIT_EVENT_LOST]'));
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('código UNKNOWN'));
  });

  it('una fila arrendada por otro proceso no se vuelve a tomar hasta que el arrendamiento vence', async () => {
    await service.enqueue(event);
    db.outbox.get(EVENT_ID)!.lockedUntil = new Date(T0.getTime() + 5 * MINUTE);

    await service.dispatchDue();

    expect(db.chain).toHaveLength(0);
    expect(db.outbox.get(EVENT_ID)!.attempts).toBe(0);

    jest.setSystemTime(new Date(T0.getTime() + 6 * MINUTE));
    await service.dispatchDue();

    expect(db.chain).toHaveLength(1);
    expect(db.outbox.size).toBe(0);
  });

  it('el marcador de atascado se cuenta desde la captura, no desde el encolado', async () => {
    jest.setSystemTime(new Date(T0.getTime() + 10 * 60 * MINUTE));
    await service.enqueue({ ...event, occurredAt: T0 });
    db.failures.push(transient());

    jest.setSystemTime(new Date(T0.getTime() + 25 * 60 * MINUTE));
    await service.dispatchDue();

    expect(db.outbox.get(EVENT_ID)).toMatchObject({ status: 'pending' });
    const messages = loggerError.mock.calls.map((call) => call[0] as string);
    expect(messages.some((m) => m.startsWith('[AUDIT_OUTBOX_STALE]'))).toBe(true);
  });

  it('si el arrendamiento venció y otra instancia tomó la fila, un fallo tardío no pisa su estado (I3)', async () => {
    await service.enqueue(event);
    db.failures.push(transient());
    const original = db.dataSource.transaction;
    jest.spyOn(db.dataSource, 'transaction').mockImplementation(async (callback: TxCallback) => {
      try {
        return await original(callback);
      } catch (error) {
        // La otra instancia toma la fila con un arrendamiento nuevo justo después de que este intento falle.
        const row = db.outbox.get(EVENT_ID)!;
        if (row.lockedUntil) row.lockedUntil = new Date(row.lockedUntil.getTime() + 5 * MINUTE);
        throw error;
      }
    });

    await service.dispatchDue();

    expect(db.outbox.get(EVENT_ID)).toMatchObject({ attempts: 0, lastError: null });
  });

  it('si la baja del outbox falla, el evento tampoco queda en la cadena (I4)', async () => {
    await service.enqueue(event);
    jest.spyOn(db.dataSource.manager, 'delete');
    const failingDelete = jest.fn().mockRejectedValueOnce(Object.assign(new Error('caída'), { code: '40P01' }));
    const original = db.dataSource.transaction;
    jest.spyOn(db.dataSource, 'transaction').mockImplementation((callback: TxCallback) =>
      original((manager: FakeManager) => callback({ ...manager, delete: failingDelete })),
    );

    await service.dispatchDue();

    expect(db.chain).toHaveLength(0);
    expect(db.outbox.get(EVENT_ID)).toMatchObject({ status: 'pending', attempts: 1, lastError: '40P01' });
  });

  it('cada fila se reclama con su propio arrendamiento: la segunda no queda cubierta por el de la primera (I3)', async () => {
    const other = { ...event, eventId: '88888888-8888-4888-8888-888888888888', correlationId: '99999999-9999-4999-8999-999999999999' };
    await service.enqueue(event);
    await service.enqueue(other);
    const claimed: string[] = [];
    const update = db.dataSource.manager.update;
    const original = db.dataSource.transaction;
    jest.spyOn(db.dataSource, 'transaction').mockImplementation((callback: TxCallback) =>
      original((manager: FakeManager) =>
        callback({
          ...manager,
          update: async (entity: unknown, criteria: { eventId: string }, values: Record<string, unknown>) => {
            if (values.lockedUntil) claimed.push(criteria.eventId);
            return update(entity, criteria, values);
          },
        }),
      ),
    );

    await service.dispatchDue();

    expect(claimed).toEqual([EVENT_ID, other.eventId]);
    expect(db.chain.map((row) => row.eventId)).toEqual([EVENT_ID, other.eventId]);
  });

  it('un evento reenviado conserva su occurred_at de captura aunque su chain_seq sea posterior (I2)', async () => {
    await service.enqueue(event);
    db.failures.push(transient());
    await service.dispatchDue();

    jest.setSystemTime(new Date(T0.getTime() + MINUTE));
    await db.dataSource.transaction((m) =>
      new AuditChainWriter().append(
        m as unknown as EntityManager,
        { ...event, eventId: '88888888-8888-4888-8888-888888888888', occurredAt: new Date(T0.getTime() + MINUTE) },
        { dedupe: false },
      ),
    );
    jest.setSystemTime(new Date(T0.getTime() + 3 * MINUTE));
    await service.dispatchDue();

    expect(db.chain.map((row) => [row.chainSeq, row.eventId])).toEqual([
      ['1', '88888888-8888-4888-8888-888888888888'],
      ['2', EVENT_ID],
    ]);
    expect(db.chain[1].occurredAt.getTime()).toBeLessThan(db.chain[0].occurredAt.getTime());
  });

  it('chain_seq no pierde precisión por encima de 2^53', async () => {
    db.chain.push({
      eventId: '88888888-8888-4888-8888-888888888888',
      organizationId: ORG_ID,
      chainSeq: '9007199254740993',
      occurredAt: new Date(),
      recordHash: 'a'.repeat(64),
    });
    await service.enqueue(event);

    await service.dispatchDue();

    expect(db.chain[1].chainSeq).toBe('9007199254740994');
  });

  it('un error de BD al actualizar una fila no hace fallar dispatchDue ni se propaga al proceso', async () => {
    await service.enqueue(event);
    db.failures.push(transient());
    jest.spyOn(db.dataSource.manager, 'update').mockRejectedValueOnce(new Error('conexión caída'));

    await expect(service.dispatchDue()).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('código UNKNOWN'));
    expect(db.chain).toHaveLength(0);
  });

  it('onModuleDestroy espera el lote en curso antes de resolver', async () => {
    const writer = new AuditChainWriter();
    const appendOriginal = writer.append.bind(writer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    jest.spyOn(writer, 'append').mockImplementationOnce(async (manager, row, options) => {
      await gate;
      return appendOriginal(manager, row, options);
    });
    const outbox = new AuditOutboxService(db.dataSource as unknown as DataSource, writer);
    await outbox.enqueue(event);
    outbox.onModuleInit();

    jest.advanceTimersByTime(30_000);
    const destroyed = outbox.onModuleDestroy();
    let finished = false;
    void destroyed.then(() => (finished = true));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(finished).toBe(false);

    release();
    await destroyed;
    expect(db.chain).toHaveLength(1);
    expect(db.outbox.size).toBe(0);
  });
});
