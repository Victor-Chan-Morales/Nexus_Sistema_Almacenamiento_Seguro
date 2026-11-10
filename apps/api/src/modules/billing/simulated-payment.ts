import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';

/** Test card that always approves the simulated charge (SPEC-305). */
export const TEST_CARD_APPROVED = '4242424242424242';
/** Test card that always declines the simulated charge (SPEC-305). */
export const TEST_CARD_DECLINED = '4000000000000002';

export interface PaymentInput {
  /** Spaces are removed before comparing. */
  cardNumber: string;
  holderName: string;
  /** 'MM/YY' */
  expiry: string;
  /** Exactly 3 digits. */
  cvv: string;
}

export type PaymentResult =
  | { status: 'approved'; last4: string }
  | { status: 'declined' }
  | { status: 'not_test_card' };

const EXPIRY_PATTERN = /^(0[1-9]|1[0-2])\/(\d{2})$/;
const CVV_PATTERN = /^\d{3}$/;

function validationError(message: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

function normalizeCardNumber(cardNumber: string): string {
  return cardNumber.replace(/\s+/g, '');
}

/**
 * Throws 400 VALIDATION_ERROR when the expiry is malformed or already past (UTC),
 * or when the CVV is not exactly 3 digits. Messages never echo the received values.
 */
export function validatePaymentFields(input: PaymentInput, now: Date): void {
  const match = EXPIRY_PATTERN.exec(input.expiry);
  if (!match) {
    throw validationError('El vencimiento debe tener el formato MM/AA');
  }

  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    throw validationError('La tarjeta está vencida');
  }

  if (!CVV_PATTERN.test(input.cvv)) {
    throw validationError('El CVV debe tener 3 dígitos');
  }
}

/** Pure, no I/O. Compares exactly against the two fixed test cards. */
export function simulatePayment(input: PaymentInput): PaymentResult {
  const cardNumber = normalizeCardNumber(input.cardNumber);
  if (cardNumber === TEST_CARD_APPROVED) {
    return { status: 'approved', last4: cardNumber.slice(-4) };
  }
  if (cardNumber === TEST_CARD_DECLINED) {
    return { status: 'declined' };
  }
  return { status: 'not_test_card' };
}

/** 402 PAYMENT_DECLINED. The controller catches it to audit and rethrows it. */
export class PaymentDeclinedException extends HttpException {
  constructor() {
    super(
      {
        code: 'PAYMENT_DECLINED',
        message:
          'La tarjeta de prueba fue rechazada. No se realizó ningún cobro y tu suscripción no cambió.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Full rule for activate and renew.
 * - Free plan (price 0) → null; a payment sent is ignored.
 * - Paid plan without payment → 400 VALIDATION_ERROR.
 * - Validates fields, simulates → 422 TEST_CARD_REQUIRED | PaymentDeclinedException | last4.
 */
export function resolveSimulatedPayment(
  plan: { priceCents: number },
  payment: PaymentInput | undefined,
  now: Date,
): string | null {
  if (plan.priceCents <= 0) {
    return null;
  }
  if (!payment) {
    throw validationError('Los datos de la tarjeta de prueba son obligatorios para este plan');
  }

  validatePaymentFields(payment, now);
  const result = simulatePayment(payment);

  switch (result.status) {
    case 'approved':
      return result.last4;
    case 'declined':
      throw new PaymentDeclinedException();
    case 'not_test_card':
      throw new UnprocessableEntityException({
        code: 'TEST_CARD_REQUIRED',
        message:
          'Solo se aceptan tarjetas de prueba. No uses tarjetas reales: esta es una simulación y no se procesa ningún cobro.',
      });
  }
}
