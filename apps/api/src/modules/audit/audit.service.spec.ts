import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { computeRecordHash, AuditHashFields } from './audit-hash';
import { AuditService } from './audit.service';
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
    service = new AuditService(dataSource as unknown as DataSource);
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
      manager.findOne.mockResolvedValueOnce({ recordHash: 'hash-anterior' });

      await service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DELETE });

      expect(insertedRow().prevHash).toBe('hash-anterior');
    });

    it('consulta el último evento filtrando por la organización del evento', async () => {
      await service.logEvent({ organizationId: OTHER_ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DELETE });

      expect(manager.findOne).toHaveBeenCalledWith(AuditEvent, {
        where: { organizationId: OTHER_ORG_ID },
        order: { occurredAt: 'DESC', eventId: 'DESC' },
      });
    });

    it('otra organización sin eventos empieza su propia cadena con prev_hash nulo', async () => {
      manager.findOne.mockResolvedValueOnce({ recordHash: 'hash-de-la-primera-org' });
      await service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DELETE });

      manager.findOne.mockResolvedValueOnce(null);
      await service.logEvent({ organizationId: OTHER_ORG_ID, actorId: ACTOR_ID, action: AuditAction.FILE_DELETE });

      expect(manager.insert.mock.calls[1][1].prevHash).toBeNull();
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

    it('no propaga el error si la transacción no puede abrirse', async () => {
      dataSource.transaction.mockRejectedValueOnce(new Error('conexión caída'));

      await expect(
        service.logEvent({ organizationId: ORG_ID, actorId: ACTOR_ID, action: AuditAction.PLAN_RENEWED }),
      ).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledTimes(1);
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

  it('trata prevHash nulo y vacío igual y distinto de un hash real', () => {
    expect(computeRecordHash({ ...base, prevHash: null })).toBe(computeRecordHash({ ...base, prevHash: '' }));
    expect(computeRecordHash({ ...base, prevHash: 'abc' })).not.toBe(computeRecordHash(base));
  });
});
