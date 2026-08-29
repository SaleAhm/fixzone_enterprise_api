import { createHmac } from 'crypto';
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentTransactionStatus } from '@prisma/client';
import { PaystackPaymentAdapter } from './paystack.adapter';

describe('PaystackPaymentAdapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      PAYMENTS_ENABLED: 'true',
      PAYSTACK_MODE: 'test',
      PAYSTACK_SECRET_KEY: 'sk_test_unit_only',
      PAYMENTS_CALLBACK_BASE_URL: 'https://billing.example.test',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails readiness when payments are default-off', () => {
    process.env.PAYMENTS_ENABLED = 'false';
    const adapter = new PaystackPaymentAdapter();

    expect(() => adapter.assertReady()).toThrow(ServiceUnavailableException);
  });

  it('validates Paystack HMAC against the exact raw body', () => {
    const adapter = new PaystackPaymentAdapter();
    const rawBody = Buffer.from('{"event":"charge.success","data":{}}');
    const signature = createHmac('sha512', 'sk_test_unit_only')
      .update(rawBody)
      .digest('hex');

    expect(adapter.validateWebhookSignature(rawBody, signature)).toBe(true);
    expect(
      adapter.validateWebhookSignature(
        Buffer.concat([rawBody, Buffer.from(' ')]),
        signature,
      ),
    ).toBe(false);
    expect(adapter.validateWebhookSignature(rawBody, undefined)).toBe(false);
  });

  it('normalizes successful webhook transaction without card data', () => {
    const adapter = new PaystackPaymentAdapter();

    const event = adapter.parseWebhookEvent({
      event: 'charge.success',
      data: {
        id: 123,
        reference: 'fz_org_abc',
        status: 'success',
        amount: 2500000,
        currency: 'NGN',
        paid_at: '2026-08-29T12:00:00.000Z',
        authorization: { bin: '539999', last4: '1111' },
        metadata: {
          organizationId: 'org-1',
          planCode: 'PROFESSIONAL',
          internalReference: 'fz_org_abc',
        },
      },
    });

    expect(event.transaction?.status).toBe(PaymentTransactionStatus.PAID);
    expect(event.transaction?.amountMinor).toBe(2500000);
    expect(event.transaction?.metadata).toEqual({
      organizationId: 'org-1',
      planCode: 'PROFESSIONAL',
      internalReference: 'fz_org_abc',
    });
  });

  it('does not parse malformed webhook payloads as trusted events', () => {
    const adapter = new PaystackPaymentAdapter();

    expect(() =>
      adapter.parseWebhookEvent({ event: 'charge.success' }),
    ).toThrow(BadGatewayException);
  });
});
