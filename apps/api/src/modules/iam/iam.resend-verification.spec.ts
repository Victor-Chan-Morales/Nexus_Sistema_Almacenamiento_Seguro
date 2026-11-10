import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TokenPurpose, UserStatus } from './domain/enums';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { IamController } from './iam.controller';
import { EmailVerificationService } from './services/email-verification.service';

const EMAIL = 'ana@example.test';
const PURPOSE = TokenPurpose.EMAIL_VERIFICATION;
const GENERIC = {
  message: 'Si la cuenta existe y aún no está verificada, recibirás un nuevo enlace de verificación.',
};
const USER = { id: 'user-1', email: EMAIL, fullName: 'Ana', emailVerified: false, status: UserStatus.ACTIVE };
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

function setup() {
  const order: string[] = [];
  const users = { findByEmailForUpdate: jest.fn().mockResolvedValue(USER) };
  const tokenRows = {
    latestCreatedAt: jest.fn().mockResolvedValue(ago(121)),
    countCreatedSince: jest.fn().mockResolvedValue(1),
    invalidateUnused: jest.fn(async () => { order.push('invalidar'); }),
  };
  const tokens = {
    issue: jest.fn(async () => {
      order.push('emitir');
      return { rawToken: 'token-sintético', expiresAt: new Date(Date.now() + 15 * 60_000) };
    }),
  };
  const outbox = {
    enqueue: jest.fn(async () => { order.push('encolar'); return 'message-1'; }),
    dispatch: jest.fn(async () => { order.push('enviar'); }),
  };
  const uow = {
    run: jest.fn(async (work: (tx: string) => Promise<unknown>) => {
      const result = await work('tx');
      order.push('commit');
      return result;
    }),
  };
  const service = new EmailVerificationService(uow as never, tokenRows as never, users as never, {} as never, tokens as never, outbox as never);
  const controller = new IamController({} as never, {} as never, {} as never, {} as never, {} as never, service);
  return { controller, service, order, users, tokenRows, tokens, outbox, uow };
}

describe('SPEC-116: reenvío de verificación', () => {
  it('normaliza, invalida y encola dentro de la misma transacción y entrega tras confirmar', async () => {
    const t = setup();
    await t.service.resend('  ANA@EXAMPLE.TEST ');
    expect(t.users.findByEmailForUpdate).toHaveBeenCalledWith(EMAIL, 'tx');
    expect(t.tokenRows.latestCreatedAt).toHaveBeenCalledWith('tx', USER.id, PURPOSE);
    expect(t.tokenRows.countCreatedSince).toHaveBeenCalledWith('tx', USER.id, PURPOSE, expect.any(Date));
    const since = t.tokenRows.countCreatedSince.mock.calls[0][3] as Date;
    expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(86_400_000);
    expect(Date.now() - since.getTime()).toBeLessThan(86_401_000);
    expect(t.tokenRows.invalidateUnused).toHaveBeenCalledWith('tx', USER.id, PURPOSE);
    expect(t.outbox.enqueue).toHaveBeenCalledWith('tx', expect.objectContaining({
      kind: 'email_verification', userId: USER.id, recipientEmail: EMAIL, expiresAt: expect.any(Date),
    }));
    expect(t.order).toEqual(['invalidar', 'emitir', 'encolar', 'commit', 'enviar']);
  });

  it.each([
    ['desconocida', null],
    ['verificada', { ...USER, emailVerified: true }],
    ['inactiva', { ...USER, status: UserStatus.INACTIVE }],
    ['bloqueada', { ...USER, status: UserStatus.LOCKED }],
  ])('una cuenta %s devuelve el mismo cuerpo y no crea registros', async (_name, user) => {
    const t = setup();
    t.users.findByEmailForUpdate.mockResolvedValueOnce(user);
    const work = jest.spyOn(t.service, 'resend');
    expect(t.controller.resendVerification({ email: EMAIL })).toEqual(GENERIC);
    await work.mock.results[0].value;
    expect(t.tokenRows.latestCreatedAt).not.toHaveBeenCalled();
    expect(t.tokenRows.invalidateUnused).not.toHaveBeenCalled();
    expect(t.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('devuelve el cuerpo genérico antes de que termine la transacción', async () => {
    const t = setup();
    const work = jest.spyOn(t.service, 'resend');
    expect(t.controller.resendVerification({ email: EMAIL })).toEqual(GENERIC);
    expect(t.outbox.enqueue).not.toHaveBeenCalled();
    await work.mock.results[0].value;
    expect(t.outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it('preserva el token anterior durante los 120 segundos', async () => {
    const t = setup();
    t.tokenRows.latestCreatedAt.mockResolvedValueOnce(ago(30));
    await t.service.resend(EMAIL);
    expect(t.tokenRows.countCreatedSince).not.toHaveBeenCalled();
    expect(t.tokenRows.invalidateUnused).not.toHaveBeenCalled();
    expect(t.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('con cinco tokens en 24 horas el reenvío queda suprimido', async () => {
    const t = setup();
    t.tokenRows.countCreatedSince.mockResolvedValueOnce(5);
    await t.service.resend(EMAIL);
    expect(t.tokenRows.invalidateUnused).not.toHaveBeenCalled();
    expect(t.tokens.issue).not.toHaveBeenCalled();
    expect(t.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('un fallo posterior al commit no se propaga ni registra datos de la cuenta', async () => {
    const t = setup();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      t.outbox.dispatch.mockRejectedValueOnce(new Error(EMAIL));
      await expect(t.service.resend(EMAIL)).resolves.toBeUndefined();
      expect(t.order).toContain('commit');
      expect(log).toHaveBeenCalledWith('No se pudo procesar el reenvío de verificación: Error');
    } finally {
      log.mockRestore();
    }
  });

  it.each(['', 'no-es-correo', 'a'.repeat(250) + '@example.test'])('el DTO rechaza correo vacío, inválido o largo', (email) => {
    expect(validateSync(plainToInstance(ResendVerificationDto, { email }))).not.toHaveLength(0);
  });

  it('el DTO recorta los espacios antes de validar', () => {
    const dto = plainToInstance(ResendVerificationDto, { email: '  ANA@EXAMPLE.TEST  ' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.email).toBe('ANA@EXAMPLE.TEST');
  });
});
