import { AuditOutboxService } from '../audit/audit-outbox.service';
import { AuditOutboxIndicator } from './audit-outbox.indicator';

describe('AuditOutboxIndicator', () => {
  it('informa pendientes y abandonados sin marcar el servicio como caído', async () => {
    const outbox = { counts: jest.fn().mockResolvedValue({ pending: 3, dead: 2 }) };
    const indicator = new AuditOutboxIndicator(outbox as unknown as AuditOutboxService);

    await expect(indicator.check()).resolves.toEqual({ audit_outbox: { status: 'up', pending: 3, dead: 2 } });
  });

  it('si la consulta falla, responde estructurado y no lanza', async () => {
    const outbox = { counts: jest.fn().mockRejectedValue(Object.assign(new Error('caída'), { code: '08006' })) };
    const indicator = new AuditOutboxIndicator(outbox as unknown as AuditOutboxService);

    await expect(indicator.check()).resolves.toEqual({
      audit_outbox: { status: 'up', available: false, error: '08006' },
    });
  });
});
