import { BadRequestException, HttpException, UnprocessableEntityException } from '@nestjs/common';
import {
  PaymentDeclinedException,
  PaymentInput,
  TEST_CARD_APPROVED,
  TEST_CARD_DECLINED,
  resolveSimulatedPayment,
  simulatePayment,
  validatePaymentFields,
} from './simulated-payment';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const PAID_PLAN = { priceCents: 999 };
const FREE_PLAN = { priceCents: 0 };

function payment(overrides: Partial<PaymentInput> = {}): PaymentInput {
  return {
    cardNumber: '4242 4242 4242 4242',
    holderName: 'Ana Pérez',
    expiry: '12/30',
    cvv: '123',
    ...overrides,
  };
}

function captureError(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('Se esperaba una excepción');
}

function responseOf(error: HttpException): { code: string; message: string } {
  return error.getResponse() as { code: string; message: string };
}

function expectNoSensitiveData(error: HttpException, input: PaymentInput): void {
  const serialized = JSON.stringify(error.getResponse()) + error.message;
  const digits = input.cardNumber.replace(/\s+/g, '');
  expect(serialized).not.toContain(digits);
  expect(serialized).not.toContain(input.cardNumber);
  expect(serialized).not.toContain(input.cvv);
}

describe('simulatePayment', () => {
  it('approves the approved test card and returns last4 (escenario 1)', () => {
    expect(simulatePayment(payment({ cardNumber: TEST_CARD_APPROVED }))).toEqual({
      status: 'approved',
      last4: '4242',
    });
  });

  it('declines the declined test card (escenario 2)', () => {
    expect(simulatePayment(payment({ cardNumber: TEST_CARD_DECLINED }))).toEqual({
      status: 'declined',
    });
  });

  it.each(['5555555555554444', '4242424242424241', '424242424242424', '', 'abcd'])(
    'returns not_test_card for every other number (escenario 3): %s',
    (cardNumber) => {
      expect(simulatePayment(payment({ cardNumber }))).toEqual({ status: 'not_test_card' });
    },
  );

  it('normalizes spaces in the card number', () => {
    expect(simulatePayment(payment({ cardNumber: ' 4242 4242  4242 4242 ' }))).toEqual({
      status: 'approved',
      last4: '4242',
    });
    expect(simulatePayment(payment({ cardNumber: '4000 0000 0000 0002' }))).toEqual({
      status: 'declined',
    });
  });
});

describe('validatePaymentFields (escenario 9)', () => {
  it('accepts a valid payment', () => {
    expect(() => validatePaymentFields(payment(), NOW)).not.toThrow();
  });

  it('accepts a card that expires in the current UTC month', () => {
    expect(() => validatePaymentFields(payment({ expiry: '11/26' }), NOW)).not.toThrow();
  });

  it('rejects a card that expired the previous month', () => {
    const error = captureError(() => validatePaymentFields(payment({ expiry: '10/26' }), NOW));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(responseOf(error).code).toBe('VALIDATION_ERROR');
  });

  it('rejects a card that expired in a previous year', () => {
    const error = captureError(() => validatePaymentFields(payment({ expiry: '12/25' }), NOW));
    expect(responseOf(error).code).toBe('VALIDATION_ERROR');
  });

  it('uses UTC to decide the current month', () => {
    // 2026-12-01T02:00Z is still November in UTC-6, but December in UTC.
    const decemberUtc = new Date('2026-12-01T02:00:00.000Z');
    expect(() => validatePaymentFields(payment({ expiry: '11/26' }), decemberUtc)).toThrow(
      BadRequestException,
    );
  });

  it.each(['00/30', '13/30', '1/30', '12/2030', '12-30', ''])(
    'rejects a malformed expiry: "%s"',
    (expiry) => {
      const error = captureError(() => validatePaymentFields(payment({ expiry }), NOW));
      expect(error.getStatus()).toBe(400);
      expect(responseOf(error).code).toBe('VALIDATION_ERROR');
    },
  );

  it.each(['12', '1234', 'abc', ''])('rejects a CVV that is not 3 digits: "%s"', (cvv) => {
    const error = captureError(() => validatePaymentFields(payment({ cvv }), NOW));
    expect(error.getStatus()).toBe(400);
    expect(responseOf(error)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'El CVV debe tener 3 dígitos',
    });
  });
});

describe('resolveSimulatedPayment', () => {
  it('returns null for a free plan without payment (escenario 5)', () => {
    expect(resolveSimulatedPayment(FREE_PLAN, undefined, NOW)).toBeNull();
  });

  it('ignores the payment on a free plan, even an invalid one', () => {
    expect(
      resolveSimulatedPayment(FREE_PLAN, payment({ cardNumber: TEST_CARD_DECLINED, cvv: '1' }), NOW),
    ).toBeNull();
  });

  it('requires payment on a paid plan (escenario 6)', () => {
    const error = captureError(() => resolveSimulatedPayment(PAID_PLAN, undefined, NOW));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(responseOf(error).code).toBe('VALIDATION_ERROR');
  });

  it('returns last4 for the approved card (escenario 1)', () => {
    expect(resolveSimulatedPayment(PAID_PLAN, payment(), NOW)).toBe('4242');
  });

  it('throws 402 PAYMENT_DECLINED for the declined card (escenario 2)', () => {
    const input = payment({ cardNumber: '4000 0000 0000 0002' });
    const error = captureError(() => resolveSimulatedPayment(PAID_PLAN, input, NOW));
    expect(error).toBeInstanceOf(PaymentDeclinedException);
    expect(error.getStatus()).toBe(402);
    expect(responseOf(error)).toEqual({
      code: 'PAYMENT_DECLINED',
      message:
        'La tarjeta de prueba fue rechazada. No se realizó ningún cobro y tu suscripción no cambió.',
    });
  });

  it('throws 422 TEST_CARD_REQUIRED for every other card and warns against real cards (escenario 3)', () => {
    const input = payment({ cardNumber: '5555 5555 5555 4444' });
    const error = captureError(() => resolveSimulatedPayment(PAID_PLAN, input, NOW));
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getStatus()).toBe(422);
    expect(responseOf(error).code).toBe('TEST_CARD_REQUIRED');
    expect(responseOf(error).message).toContain('No uses tarjetas reales');
  });

  it('validates fields before simulating (escenario 9)', () => {
    const input = payment({ cardNumber: TEST_CARD_DECLINED, expiry: '01/20' });
    const error = captureError(() => resolveSimulatedPayment(PAID_PLAN, input, NOW));
    expect(error.getStatus()).toBe(400);
    expect(responseOf(error).code).toBe('VALIDATION_ERROR');
  });

  it.each<[string, PaymentInput]>([
    ['declined', payment({ cardNumber: '4000 0000 0000 0002', cvv: '987' })],
    ['other card', payment({ cardNumber: '5555 5555 5555 4444', cvv: '987' })],
    ['expired', payment({ cardNumber: '5555 5555 5555 4444', expiry: '01/20', cvv: '987' })],
    ['bad cvv', payment({ cardNumber: '5555 5555 5555 4444', cvv: '98' })],
  ])('never echoes the card number or the CVV in the error (escenario 8): %s', (_label, input) => {
    const error = captureError(() => resolveSimulatedPayment(PAID_PLAN, input, NOW));
    expectNoSensitiveData(error, input);
  });
});
