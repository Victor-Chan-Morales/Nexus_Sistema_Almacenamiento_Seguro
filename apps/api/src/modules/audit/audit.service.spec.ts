import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { computeRecordHash, AuditHashFields } from './audit-hash';
import { AuditService } from './audit.service';
import { AuditChainWriter } from './audit-chain-writer';
import { AuditOutboxService } from './audit-outbox.service';
import { AuditEvent, AuditActorType, AuditResult } from './entities/audit-event.entity';
import { AuditAction, AuditResource } from './audit.types';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('AuditService — Pruebas unitarias del registro encadenado (SPEC-401)', () => {
  let service: AuditService;
  let manager: {
    query: jest.Mock;
    findOne: jest.Mock;
    insert: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let outbox: { enqueue: jest.Mock };
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    manager = {
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      transaction: jest.fn(async (callback: (m: typeof manager) => Promise<void>) => callback(manager)),
    };
    outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new AuditService(
      dataSource as unknown as DataSource,
      new AuditChainWriter(),
      outbox as unknown as AuditOutboxService,
    );
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const insertedRow = (): Partial<AuditEvent> => manager.insert.mock.calls[0][1] as Partial<AuditEvent>;

  describe('Escenario 1: registro de un evento', () => {
    it('inserta una fila con los campos de la spec y prev_hash nulo en el primer evento', async () => {
      await service.logEvent({
        organizationId: ORG_ID,
        actorId: ACTOR_ID,
        action: AuditAction.FILE_UPLOAD,
        resourceType: AuditResource.FILE,
        resourceId: RESOURCE_ID,
      });

      expect(manager.insert).toHaveBeenCalledTimes(1);
      expect(manager.insert.mock.calls[0][0]).toBe(AuditEvent);
      const row = insertedRow();
      expect(row.eventId).toMatch(UUID_PATTERN);
      expect(row.organizationId).toBe(ORG_ID);
      expect(row.actorType).toBe(AuditActorType.USER);
      expect(row.actorId).toBe(ACTOR_ID);
      expect(row.actionType).toBe('FILE_UPLOAD');
      expect(row.resourceType).toBe('file');
      expect(row.resourceId).toBe(RESOURCE_ID);
      expect(row.result).toBe(AuditResult.SUCCESS);
      expect(row.correlationId).toMatch(UUID_PATTERN);
      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(row.recordHash).toEqual(expect.any(String));
      expect(row.recordHash).not.toBe('');
      expect(row.prevHash).toBeNull();
    });

    it('usa el correlationId recibido cuando se proporciona', async () => {
      const correlationId = '55555555-5555-4555-8555-555555555555';

      await service.logEvent({
        organizationId: ORG_ID,
        actorId: ACTOR_ID,
        action: AuditAction.MEMBER_ADDED,
        correlationId,
      });

      expect(insertedRow().correlationId).toBe(correlationId);
    });
  });

  describe('Escenario 2: encadenamiento', () => {
    it('toma el record_hash del último evento de la organización como prev_hash', async () => {
      manager.findOne.mockResolvedValueOnce({ recordHash: 'hash-anterior', chainSeq: '4' });

      await service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DELETE });

      expect(insertedRow().prevHash).toBe('hash-anterior');
      expect(insertedRow().chainSeq).toBe('5');
    });

    it('consulta el último evento por chain_seq filtrando por la organización del evento', async () => {
      await service.logEvent({ organizationId: OTHER_ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DELETE });

      expect(manager.findOne).toHaveBeenCalledWith(AuditEvent, {
        where: { organizationId: OTHER_ORG_ID },
        select: { recordHash: true, chainSeq: true },
        order: { chainSeq: 'DESC' },
      });
    });

    it('otra organización sin eventos empieza su propia cadena con prev_hash nulo y chain_seq 1', async () => {
      manager.findOne.mockResolvedValueOnce({ recordHash: 'hash-de-la-primera-org', chainSeq: '1' });
      await service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DELETE });

      manager.findOne.mockResolvedValueOnce(null);
      await service.logEvent({ organizationId: OTHER_ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DELETE });

      expect(manager.insert.mock.calls[1][1].prevHash).toBeNull();
      expect(manager.insert.mock.calls[1][1].chainSeq).toBe('1');
    });
  });

  describe('Escenario 3: eventos concurrentes', () => {
    it('toma el bloqueo consultivo por organización antes de leer la cadena y fijar occurred_at', async () => {
      const order: string[] = [];
      manager.query.mockImplementation(async () => {
        order.push('lock');
      });
      manager.findOne.mockImplementation(async () => {
        order.push('read');
        return null;
      });
      manager.insert.mockImplementation(async () => {
        order.push('insert');
      });

      await service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.AUTH_LOGIN });

      expect(order).toEqual(['lock', 'read', 'insert']);
      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [ORG_ID],
      );
    });
  });

  describe('Escenario 3b: cadena lineal con eventos concurrentes en el mismo milisegundo', () => {
    const SAME_MILLISECOND = new Date('2026-10-29T12:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers({ now: SAME_MILLISECOND });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('20 registros simultáneos de una organización forman una sola cadena sin bifurcaciones', async () => {
      const chain = createInMemoryChain();
      const concurrentService = new AuditService(
        chain.dataSource as unknown as DataSource,
        new AuditChainWriter(),
        { enqueue: jest.fn() } as unknown as AuditOutboxService,
      );

      await Promise.all(
        Array.from({ length: 20 }, () =>
          concurrentService.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DOWNLOAD }),
        ),
      );

      // Si la lectura del último evento ocurriera sin el bloqueo, dos eventos compartirían padre y la BD fallaría.
      expect(loggerError).not.toHaveBeenCalled();
      expect(chain.rows).toHaveLength(20);
      expect(new Set(chain.rows.map((row) => row.occurredAt.getTime())).size).toBe(1);

      const ordered = [...chain.rows].sort((a, b) => Number(a.chainSeq) - Number(b.chainSeq));
      expect(ordered.map((row) => Number(row.chainSeq))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(ordered[0].prevHash).toBeNull();
      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i].prevHash).toBe(ordered[i - 1].recordHash);
      }
    });
  });

  /**
   * Fake en memoria de `audit.audit_event`: el bloqueo consultivo serializa las transacciones y las
   * restricciones únicas de la migración 20261029090000 rechazan cualquier bifurcación.
   */
  function createInMemoryChain() {
    const rows: Array<Record<string, any>> = [];
    let lockTail: Promise<void> = Promise.resolve();

    const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' });

    const openManager = () => {
      let releaseLock: () => void = () => undefined;
      return {
        releaseLock: () => releaseLock(),
        query: async () => {
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => (releaseLock = resolve));
          await previous;
        },
        findOne: async (_entity: unknown, options: { where: { organizationId: string } }) => {
          const own = rows.filter((row) => row.organizationId === options.where.organizationId);
          return own.reduce<Record<string, any> | null>(
            (max, row) => (!max || Number(row.chainSeq) > Number(max.chainSeq) ? row : max),
            null,
          );
        },
        insert: async (_entity: unknown, row: Record<string, any>) => {
          const sameOrg = rows.filter((other) => other.organizationId === row.organizationId);
          const clashes =
            sameOrg.some((other) => other.chainSeq === row.chainSeq) ||
            (row.prevHash === null
              ? sameOrg.some((other) => other.prevHash === null)
              : sameOrg.some((other) => other.prevHash === row.prevHash));
          if (clashes) throw uniqueViolation();
          rows.push({ ...row });
        },
      };
    };

    const dataSource = {
      transaction: async (callback: (m: ReturnType<typeof openManager>) => Promise<void>) => {
        const transactional = openManager();
        try {
          await callback(transactional);
        } finally {
          transactional.releaseLock();
        }
      },
    };

    return { rows, dataSource };
  }

  describe('Escenario 4: nunca bloquea la operación', () => {
    it('no propaga el error si el INSERT falla y registra solo el código, sin datos del evento', async () => {
      manager.insert.mockRejectedValueOnce(Object.assign(new Error(`Key (organization_id)=(${ORG_ID})`), { code: '23503' }));

      await expect(
        service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_PURGE }),
      ).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledTimes(1);
      const message = loggerError.mock.calls[0][0] as string;
      expect(message).toContain('23503');
      expect(message).not.toContain(ORG_ID);
      expect(message).not.toContain('FILE_PURGE');
    });

    it('si el INSERT falla, encola el evento con el mismo event_id y correlation_id que intentó', async () => {
      manager.insert.mockRejectedValueOnce(Object.assign(new Error('conexión caída'), { code: '40P01' }));

      await service.logEvent({
        organizationId: ORG_ID,
        actorId: ACTOR_ID,
        action: AuditAction.FILE_DOWNLOAD,
        resourceType: AuditResource.FILE,
        resourceId: RESOURCE_ID,
        correlationId: '55555555-5555-4555-8555-555555555555',
      });

      expect(outbox.enqueue).toHaveBeenCalledTimes(1);
      const attempted = manager.insert.mock.calls[0][1];
      expect(outbox.enqueue).toHaveBeenCalledWith({
        eventId: attempted.eventId,
        organizationId: ORG_ID,
        actorId: ACTOR_ID,
        action: AuditAction.FILE_DOWNLOAD,
        resourceType: AuditResource.FILE,
        resourceId: RESOURCE_ID,
        correlationId: '55555555-5555-4555-8555-555555555555',
        occurredAt: expect.any(Date),
      });
    });

    it('no encola cuando el registro directo funciona', async () => {
      await service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.AUTH_LOGIN });

      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('no propaga el error si la transacción no puede abrirse', async () => {
      dataSource.transaction.mockRejectedValueOnce(new Error('conexión caída'));

      await expect(
        service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.PLAN_RENEWED }),
      ).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, null])('no propaga un fallo lanzado como %s', async (thrown) => {
      dataSource.transaction.mockRejectedValueOnce(thrown);

      await expect(
        service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.PLAN_ACTIVATED }),
      ).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('código UNKNOWN'));
    });
  });

  describe('Escenario 5: sin datos sensibles', () => {
    it('la fila insertada solo contiene columnas de la tabla, sin campos libres', async () => {
      await service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.AUTH_PASSWORD_RESET });

      expect(Object.keys(insertedRow()).sort()).toEqual(
        [
          'actionType',
          'actorId',
          'actorType',
          'chainSeq',
          'correlationId',
          'eventId',
          'occurredAt',
          'organizationId',
          'prevHash',
          'recordHash',
          'resourceId',
          'resourceType',
          'result',
        ].sort(),
      );
    });
  });
});

describe('computeRecordHash', () => {
  const base: AuditHashFields = {
    prevHash: null,
    chainSeq: '1',
    eventId: '66666666-6666-4666-8666-666666666666',
    organizationId: ORG_ID,
    actorType: AuditActorType.USER,
    actorId: ACTOR_ID,
    actionType: 'FILE_UPLOAD',
    resourceType: 'file',
    resourceId: RESOURCE_ID,
    result: AuditResult.SUCCESS,
    correlationId: '77777777-7777-4777-8777-777777777777',
    occurredAt: new Date('2026-10-30T10:00:00.000Z'),
  };

  it('es determinista para los mismos campos', () => {
    expect(computeRecordHash(base)).toBe(computeRecordHash({ ...base }));
  });

  it('produce un SHA-256 hexadecimal de 64 caracteres', () => {
    expect(computeRecordHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['prevHash', 'otro-hash'],
    ['chainSeq', '2'],
    ['eventId', '88888888-8888-4888-8888-888888888888'],
    ['organizationId', OTHER_ORG_ID],
    ['actorId', '99999999-9999-4999-8999-999999999999'],
    ['actionType', 'FILE_DELETE'],
    ['resourceType', 'membership'],
    ['resourceId', '12121212-1212-4121-8121-121212121212'],
    ['correlationId', '13131313-1313-4131-8131-131313131313'],
    ['occurredAt', new Date('2026-10-30T10:00:00.001Z')],
  ] as const)('cambia cuando cambia %s', (field, value) => {
    expect(computeRecordHash({ ...base, [field]: value })).not.toBe(computeRecordHash(base));
  });

  it('no colisiona cuando un valor contiene el separador que usaba la versión anterior', () => {
    const withPipeInAction = computeRecordHash({ ...base, actionType: 'X|', resourceType: null });
    const withPipeInResource = computeRecordHash({ ...base, actionType: 'X', resourceType: '|' });

    expect(withPipeInAction).not.toBe(withPipeInResource);
  });

  it('trata prevHash nulo y vacío igual y distinto de un hash real', () => {
    expect(computeRecordHash({ ...base, prevHash: null })).toBe(computeRecordHash({ ...base, prevHash: '' }));
    expect(computeRecordHash({ ...base, prevHash: 'abc' })).not.toBe(computeRecordHash(base));
  });
});
