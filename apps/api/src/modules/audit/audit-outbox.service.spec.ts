import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
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

/**
 * Fake en memoria de la BD: la tabla del outbox, la cadena de auditoría y fallos inyectables en el INSERT de la cadena.
 * Replica lo que usa el servicio: reclamo con lease, update por event_id, exists/findOne/insert de la cadena.
 */
function createFakeDb() {
  const outbox = new Map<string, Record<string, any>>();
  const chain: Record<string, any>[] = [];
  const failures: Error[] = [];

  const idsOf = (criteria: { eventId: any }): string[] => {
    const value = criteria.eventId;
    return Array.isArray(value?.value) ? value.value : [value];
  };
  const update = async (_entity: unknown, criteria: { eventId: any }, values: Record<string, unknown>) => {
    for (const id of idsOf(criteria)) {
      if (outbox.has(id)) Object.assign(outbox.get(id)!, values);
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
      getMany: async () =>
        [...outbox.values()]
          .filter(
            (row) =>
              row.status === 'pending' &&
              row.nextAttemptAt.getTime() <= now.getTime() &&
              (row.lockedUntil == null || row.lockedUntil.getTime() <= now.getTime()),
          )
          .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
          .slice(0, 20)
          .map((row) => ({ ...row })),
    };
    return api;
  };

  const manager = {
    createQueryBuilder: () => claimBuilder(),
    update,
    query: async () => undefined,
    exists: async (_entity: unknown, options: { where: { eventId: string } }) =>
      chain.some((row) => row.eventId === options.where.eventId),
    findOne: async (_entity: unknown, options: { where: { organizationId: string } }) =>
      chain
        .filter((row) => row.organizationId === options.where.organizationId)
        .reduce<Record<string, any> | null>(
          (max, row) => (!max || Number(row.chainSeq) > Number(max.chainSeq) ? row : max),
          null,
        ),
    insert: async (_entity: unknown, row: Record<string, any>) => {
      if (failures.length > 0) throw failures.shift();
      chain.push({ ...row });
    },
  };

  const dataSource = {
    transaction: async (callback: (m: typeof manager) => Promise<void> | Promise<unknown>) => callback(manager),
    manager: { update, delete: remove },
    getRepository: () => ({
      insert: async (row: Record<string, any>) =>
        outbox.set(row.eventId, {
          ...row,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          createdAt: new Date(),
          lastError: null,
          lockedUntil: null,
        }),
      countBy: async ({ status }: { status: string }) =>
        [...outbox.values()].filter((row) => row.status === status).length,
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
    await db.dataSource.transaction((m) => new AuditChainWriter().append(m as any, event, { dedupe: false }));
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

  it('superadas 24 h desde la captura, un fallo transitorio deja el evento dead sin reintentar', async () => {
    await service.enqueue(event);
    db.failures.push(transient());
    jest.setSystemTime(new Date(T0.getTime() + 25 * 60 * MINUTE));

    await service.dispatchDue();

    expect(db.outbox.get(EVENT_ID)).toMatchObject({ status: 'dead', lastError: '40P01' });
    expect(db.chain).toHaveLength(0);
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

  it('counts informa pendientes y abandonados para el health check', async () => {
    await service.enqueue(event);
    expect(await service.counts()).toEqual({ pending: 1, dead: 0 });

    db.failures.push(permanent());
    await service.dispatchDue();
    expect(await service.counts()).toEqual({ pending: 0, dead: 1 });
  });

  it('enqueue nunca lanza: si no puede guardar, registra el código y termina', async () => {
    jest.spyOn(db.dataSource, 'getRepository').mockImplementationOnce(() => {
      throw new Error('caída');
    });

    await expect(service.enqueue(event)).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('código UNKNOWN'));
  });

  it('un lote arrendado por otro proceso no se vuelve a tomar hasta que el arrendamiento vence', async () => {
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

  it('el horizonte de 24 h se cuenta desde la captura, no desde el encolado', async () => {
    jest.setSystemTime(new Date(T0.getTime() + 10 * 60 * MINUTE));
    await service.enqueue({ ...event, occurredAt: T0 });
    db.failures.push(transient());

    jest.setSystemTime(new Date(T0.getTime() + 25 * 60 * MINUTE));
    await service.dispatchDue();

    expect(db.outbox.get(EVENT_ID)).toMatchObject({ status: 'dead', lastError: '40P01' });
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
