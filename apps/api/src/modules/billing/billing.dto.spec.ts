import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ActivateSubscriptionDto, RenewSubscriptionDto } from './billing.dto';

/** Same options as the global pipe in main.ts. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

const PLAN_ID = '3f1c2b9e-8d4a-4c1e-9b7a-2e5d6f8a1c3b';

function metadataFor(metatype: ArgumentMetadata['metatype']): ArgumentMetadata {
  return { type: 'body', metatype, data: '' };
}

function validPayment(): Record<string, string> {
  return { cardNumber: '4242424242424242', holderName: 'Ana Pérez', expiry: '12/30', cvv: '123' };
}

async function expectRejected(body: unknown, metatype: ArgumentMetadata['metatype']): Promise<void> {
  await expect(pipe.transform(body, metadataFor(metatype))).rejects.toBeInstanceOf(
    BadRequestException,
  );
}

describe('ActivateSubscriptionDto', () => {
  const activate = metadataFor(ActivateSubscriptionDto);

  it('accepts a body without payment', async () => {
    const result = (await pipe.transform({ planId: PLAN_ID }, activate)) as ActivateSubscriptionDto;
    expect(result.payment).toBeUndefined();
  });

  it('normalizes spaces in the card number', async () => {
    const result = (await pipe.transform(
      { planId: PLAN_ID, payment: { ...validPayment(), cardNumber: '4242 4242 4242 4242' } },
      activate,
    )) as ActivateSubscriptionDto;
    expect(result.payment?.cardNumber).toBe('4242424242424242');
  });

  it('rejects an expiry with month 13', async () => {
    await expectRejected(
      { planId: PLAN_ID, payment: { ...validPayment(), expiry: '13/30' } },
      ActivateSubscriptionDto,
    );
  });

  it('rejects an expiry with month 00', async () => {
    await expectRejected(
      { planId: PLAN_ID, payment: { ...validPayment(), expiry: '00/30' } },
      ActivateSubscriptionDto,
    );
  });

  it('rejects a CVV with 2 digits', async () => {
    await expectRejected(
      { planId: PLAN_ID, payment: { ...validPayment(), cvv: '12' } },
      ActivateSubscriptionDto,
    );
  });

  it('rejects an unknown field inside payment', async () => {
    await expectRejected(
      { planId: PLAN_ID, payment: { ...validPayment(), pin: '0000' } },
      ActivateSubscriptionDto,
    );
  });

  it('rejects an empty holder name', async () => {
    await expectRejected(
      { planId: PLAN_ID, payment: { ...validPayment(), holderName: '' } },
      ActivateSubscriptionDto,
    );
  });

  it('does not echo the card number or the CVV in validation messages', async () => {
    const body = {
      planId: PLAN_ID,
      payment: { ...validPayment(), cardNumber: '5555 5555 5555 4444', expiry: '13/30', cvv: '98' },
    };
    const error = await pipe.transform(body, activate).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    const serialized = JSON.stringify((error as BadRequestException).getResponse());
    expect(serialized).not.toContain('5555555555554444');
    expect(serialized).not.toContain('5555 5555 5555 4444');
    expect(serialized).not.toContain('98');
  });
});

describe('RenewSubscriptionDto', () => {
  it('accepts an empty body', async () => {
    const result = (await pipe.transform({}, metadataFor(RenewSubscriptionDto))) as RenewSubscriptionDto;
    expect(result.payment).toBeUndefined();
  });

  it('accepts and normalizes a payment', async () => {
    const result = (await pipe.transform(
      { payment: { ...validPayment(), cardNumber: '4000 0000 0000 0002' } },
      metadataFor(RenewSubscriptionDto),
    )) as RenewSubscriptionDto;
    expect(result.payment?.cardNumber).toBe('4000000000000002');
  });

  it('rejects a planId in the renew body', async () => {
    await expectRejected({ planId: PLAN_ID }, RenewSubscriptionDto);
  });

  it('rejects an invalid CVV', async () => {
    await expectRejected({ payment: { ...validPayment(), cvv: '1234' } }, RenewSubscriptionDto);
  });
});
