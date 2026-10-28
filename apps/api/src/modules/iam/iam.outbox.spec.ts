import { Logger } from '@nestjs/common';
import { OutboxCipher } from './infrastructure/outbox-cipher';
import { EmailOutboxService } from './services/email-outbox.service';

const MIN = 60_000;
const HOUR = 60 * MIN;
const TOKEN = 'TOKEN-SECRETO-123';
const TOKEN_NUEVO = 'TOKEN-RENOVADO-456';
const EMAIL = 'ana@test.com';

const cipher = new OutboxCipher({
  getOrThrow: () => 'secreto-de-prueba-con-mas-de-treinta-y-dos-caracteres',
} as never);

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'out-1',
  kind: 'email_verification',
  userId: 'u1',
  recipientEmail: EMAIL,
  recipientName: 'Ana',
  encryptedPayload: cipher.encrypt(TOKEN),
  attempts: 0,
  expiresAt: new Date(Date.now() + 15 * MIN),
  createdAt: new Date(),
  ...overrides,
});

const build = (claimed: unknown[] = []) => {
  const outbox = {
    create: jest.fn().mockResolvedValue('out-1'),
    claimDue: jest.fn().mockResolvedValue(claimed),
    updatePayload: jest.fn().mockResolvedValue(undefined),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    markExpired: jest.fn().mockResolvedValue(undefined),
  };
  const mailer = {
    sendVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    sendMemberInvitation: jest.fn().mockResolvedValue(undefined),
  };
  const uow = { run: jest.fn((work: (tx: unknown) => unknown) => work('tx')) };
  const tokens = {
    issue: jest.fn().mockResolvedValue({ rawToken: TOKEN_NUEVO, expiresAt: new Date(Date.now() + 15 * MIN) }),
  };
  const service = new EmailOutboxService(uow as never, outbox as never, cipher, mailer as never, tokens as never);
  return { service, outbox, mailer, uow, tokens };
};

describe('EmailOutboxService (outbox persistente de correo)', () => {
  it('al encolar guarda el token cifrado, nunca en claro', async () => {
    const t = build();
    await t.service.enqueue('tx' as never, {
      kind: 'password_reset',
      userId: 'u1',
      recipientEmail: EMAIL,
      recipientName: 'Ana',
      rawToken: TOKEN,
      expiresAt: new Date(),
    });

    const stored = t.outbox.create.mock.calls[0][1] as { kind: string; encryptedPayload: string; userId: string };
    expect(stored.kind).toBe('password_reset');
    expect(stored.userId).toBe('u1'); // permite emitir un token nuevo al reintentar
    expect(stored.encryptedPayload).not.toContain(TOKEN);
    expect(cipher.decrypt(stored.encryptedPayload)).toBe(TOKEN);
  });

  it('envío correcto: descifra el token, lo entrega por correo y marca el mensaje como enviado', async () => {
    const t = build([message()]);

    await t.service.dispatch('out-1');

    expect(t.outbox.claimDue).toHaveBeenCalledWith('tx', expect.objectContaining({ ids: ['out-1'] }));
    expect(t.mailer.sendVerification).toHaveBeenCalledWith(EMAIL, 'Ana', TOKEN);
    expect(t.tokens.issue).not.toHaveBeenCalled(); // el token vigente no se toca
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

  it('si el token venció esperando al proveedor, el reintento emite uno nuevo y entrega ese enlace', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const t = build([message({ expiresAt: new Date(Date.now() - MIN), createdAt: new Date(Date.now() - HOUR) })]);

    await t.service.dispatch('out-1');

    expect(t.tokens.issue).toHaveBeenCalledWith('tx', 'u1');
    const renewed = t.outbox.updatePayload.mock.calls[0][1] as { encryptedPayload: string; expiresAt: Date };
    expect(cipher.decrypt(renewed.encryptedPayload)).toBe(TOKEN_NUEVO);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(t.mailer.sendVerification).toHaveBeenCalledWith(EMAIL, 'Ana', TOKEN_NUEVO);
    expect(t.outbox.markSent).toHaveBeenCalledWith('out-1');
    expect(t.outbox.markExpired).not.toHaveBeenCalled(); // la cuenta no queda sin enlace utilizable
    log.mockRestore();
  });

  it.each([
    ['password_reset', 'sendPasswordReset'],
    ['member_invitation', 'sendMemberInvitation'],
  ] as const)('un mensaje %s se envía con %s y el token descifrado', async (kind, method) => {
    const t = build([message({ kind })]);

    await t.service.dispatch('out-1');

    expect(t.mailer[method]).toHaveBeenCalledWith(EMAIL, 'Ana', TOKEN);
    expect(t.mailer.sendVerification).not.toHaveBeenCalled();
    expect(t.outbox.markSent).toHaveBeenCalledWith('out-1');
  });

  it('un mensaje member_invitation vencido NO emite token nuevo: se marca expirado y no se envía', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = build([message({ kind: 'member_invitation', expiresAt: new Date(Date.now() - MIN) })]);

    await t.service.dispatch('out-1');

    expect(t.tokens.issue).not.toHaveBeenCalled();
    expect(t.outbox.updatePayload).not.toHaveBeenCalled();
    expect(t.mailer.sendMemberInvitation).not.toHaveBeenCalled();
    expect(t.outbox.markExpired).toHaveBeenCalledWith('out-1');
    warn.mockRestore();
  });

  it('un password_reset vencido tampoco renueva el token', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = build([message({ kind: 'password_reset', expiresAt: new Date(Date.now() - MIN) })]);

    await t.service.dispatch('out-1');

    expect(t.tokens.issue).not.toHaveBeenCalled();
    expect(t.mailer.sendPasswordReset).not.toHaveBeenCalled();
    expect(t.outbox.markExpired).toHaveBeenCalledWith('out-1');
    warn.mockRestore();
  });

  it('pasadas 24 h desde el registro el mensaje se abandona y no se envía', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = build([message({ createdAt: new Date(Date.now() - 25 * HOUR) })]);

    await t.service.dispatch('out-1');

    expect(t.mailer.sendVerification).not.toHaveBeenCalled();
    expect(t.tokens.issue).not.toHaveBeenCalled();
    expect(t.outbox.markExpired).toHaveBeenCalledWith('out-1');
    warn.mockRestore();
  });

  it('si el siguiente reintento caería después de las 24 h, el mensaje se abandona en lugar de reprogramarse', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // Quedan 60 s de horizonte y el primer reintento espera 120 s: ya no tiene sentido reprogramar.
    const t = build([message({ createdAt: new Date(Date.now() - 24 * HOUR + MIN) })]);
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
