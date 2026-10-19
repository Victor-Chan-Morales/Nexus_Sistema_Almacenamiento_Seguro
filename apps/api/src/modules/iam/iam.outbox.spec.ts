import { Logger } from '@nestjs/common';
import { OutboxCipher } from './infrastructure/outbox-cipher';
import { EmailOutboxService } from './services/email-outbox.service';

const MIN = 60_000;
const TOKEN = 'TOKEN-SECRETO-123';
const EMAIL = 'ana@test.com';

const cipher = new OutboxCipher({
  getOrThrow: () => 'secreto-de-prueba-con-mas-de-treinta-y-dos-caracteres',
} as never);

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'out-1',
  recipientEmail: EMAIL,
  recipientName: 'Ana',
  encryptedPayload: cipher.encrypt(TOKEN),
  attempts: 0,
  expiresAt: new Date(Date.now() + 15 * MIN),
  ...overrides,
});

const build = (claimed: unknown[] = []) => {
  const outbox = {
    create: jest.fn().mockResolvedValue('out-1'),
    claimDue: jest.fn().mockResolvedValue(claimed),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    markExpired: jest.fn().mockResolvedValue(undefined),
  };
  const mailer = { sendVerification: jest.fn().mockResolvedValue(undefined) };
  const uow = { run: jest.fn((work: (tx: unknown) => unknown) => work('tx')) };
  const service = new EmailOutboxService(uow as never, outbox as never, cipher, mailer as never);
  return { service, outbox, mailer, uow };
};

describe('EmailOutboxService (outbox persistente de correo)', () => {
  it('al encolar guarda el token cifrado, nunca en claro', async () => {
    const t = build();
    await t.service.enqueueVerification('tx' as never, {
      recipientEmail: EMAIL,
      recipientName: 'Ana',
      rawToken: TOKEN,
      expiresAt: new Date(),
    });

    const stored = t.outbox.create.mock.calls[0][1] as { encryptedPayload: string };
    expect(stored.encryptedPayload).not.toContain(TOKEN);
    expect(cipher.decrypt(stored.encryptedPayload)).toBe(TOKEN);
  });

  it('envío correcto: descifra el token, lo entrega por correo y marca el mensaje como enviado', async () => {
    const t = build([message()]);

    await t.service.dispatch('out-1');

    expect(t.outbox.claimDue).toHaveBeenCalledWith('tx', expect.objectContaining({ ids: ['out-1'] }));
    expect(t.mailer.sendVerification).toHaveBeenCalledWith(EMAIL, 'Ana', TOKEN);
    expect(t.outbox.markSent).toHaveBeenCalledWith('out-1');
    expect(t.outbox.markFailed).not.toHaveBeenCalled();
  });

  it('si el SMTP falla no lanza, programa un reintento sin token y registra solo el tipo de error', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const t = build([message()]);
    t.mailer.sendVerification.mockRejectedValue(new Error(`ECONNREFUSED para ${EMAIL} con ${TOKEN}`));

    await expect(t.service.dispatch('out-1')).resolves.toBeUndefined();

    const update = t.outbox.markFailed.mock.calls[0][1] as { attempts: number; nextAttemptAt: Date; lastError: string };
    expect(t.outbox.markFailed).toHaveBeenCalledWith('out-1', expect.any(Object));
    expect(update.attempts).toBe(1);
    expect(update.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(update.lastError).toBe('Error');
    expect(t.outbox.markSent).not.toHaveBeenCalled();

    const logged = spy.mock.calls.map((call) => String(call[0])).join(' ');
    expect(logged).toContain('out-1');
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(EMAIL);
    spy.mockRestore();
  });

  it('un mensaje ya vencido no se envía: se marca como vencido', async () => {
    const t = build([message({ expiresAt: new Date(Date.now() - MIN) })]);

    await t.service.dispatch('out-1');

    expect(t.mailer.sendVerification).not.toHaveBeenCalled();
    expect(t.outbox.markExpired).toHaveBeenCalledWith('out-1');
  });

  it('si el siguiente reintento llegaría después del vencimiento del token, el mensaje vence en lugar de reintentarse', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // El primer reintento espera 120 s; si solo quedan 60 s de vigencia, ya no tiene sentido reintentar.
    const t = build([message({ expiresAt: new Date(Date.now() + MIN) })]);
    t.mailer.sendVerification.mockRejectedValue(new Error('SMTP caído'));

    await t.service.dispatch('out-1');

    expect(t.outbox.markExpired).toHaveBeenCalledWith('out-1');
    expect(t.outbox.markFailed).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('el worker reclama mensajes vencidos sin filtrar por id', async () => {
    const t = build([]);

    await t.service.dispatchDue();

    const claim = t.outbox.claimDue.mock.calls[0][1] as { ids?: string[]; limit: number };
    expect(claim.ids).toBeUndefined();
    expect(claim.limit).toBe(20);
  });

  it('si no puede reclamar mensajes, el error se registra y no se propaga', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const t = build();
    t.uow.run.mockRejectedValue(Object.assign(new Error('conexión caída'), { name: 'QueryFailedError' }) as never);

    await expect(t.service.dispatchDue()).resolves.toBeUndefined();

    expect(String(spy.mock.calls[0][0])).toContain('QueryFailedError');
    spy.mockRestore();
  });

  it('el cifrado rechaza un payload alterado (AES-GCM autentica el contenido)', () => {
    const payload = cipher.encrypt(TOKEN);
    const [iv, tag, data] = payload.split('.');
    const altered = [iv, tag, data.slice(0, -2) + (data.endsWith('AA') ? 'BB' : 'AA')].join('.');

    expect(() => cipher.decrypt(altered)).toThrow();
  });
});
