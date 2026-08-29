import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PaymentEnvironment,
  PaymentProvider,
  PaymentTransactionStatus,
} from '@prisma/client';
import {
  NormalizedProviderTransaction,
  NormalizedWebhookEvent,
  PaymentInitializationRequest,
  PaymentInitializationResult,
  PaymentProviderAdapter,
} from './payment.types';

@Injectable()
export class PaystackPaymentAdapter implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.PAYSTACK;
  readonly environment =
    (process.env.PAYSTACK_MODE ?? 'test').toLowerCase() === 'live'
      ? PaymentEnvironment.LIVE
      : PaymentEnvironment.TEST;

  private readonly baseUrl = 'https://api.paystack.co';
  private readonly timeoutMs = Math.max(
    1000,
    Number(process.env.PAYMENTS_HTTP_TIMEOUT_MS ?? 8000),
  );

  constructor() {
    if (process.env.PAYMENTS_ENABLED === 'true') {
      this.assertReady();
      if (!process.env.PAYMENTS_CALLBACK_BASE_URL?.trim()) {
        throw new ServiceUnavailableException({
          code: 'PAYMENTS_CALLBACK_MISSING',
          message: 'Payment callback URL is not configured.',
        });
      }
    }
  }

  assertReady() {
    if (process.env.PAYMENTS_ENABLED !== 'true') {
      throw new ServiceUnavailableException({
        code: 'PAYMENTS_DISABLED',
        message: 'Payments are not enabled.',
      });
    }
    const key = this.secretKey();
    if (!key) {
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_SECRET_MISSING',
        message: 'Payment provider is not configured.',
      });
    }
    if (this.environment === PaymentEnvironment.LIVE && key.includes('test')) {
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_LIVE_KEY_REQUIRED',
        message: 'Live payments require an approved live provider key.',
      });
    }
  }

  async initializeTransaction(
    request: PaymentInitializationRequest,
  ): Promise<PaymentInitializationResult> {
    this.assertReady();
    const response = await this.postPaystack('/transaction/initialize', {
      email: request.email,
      amount: request.amountMinor,
      currency: request.currency,
      reference: request.reference,
      callback_url: request.callbackUrl,
      metadata: request.metadata,
      ...(request.planReference ? { plan: request.planReference } : {}),
    });
    const data = this.mapData(response);
    return {
      authorizationUrl: this.requiredString(data.authorization_url),
      accessCode: this.requiredString(data.access_code),
      providerReference: this.requiredString(
        data.reference ?? request.reference,
      ),
    };
  }

  async verifyTransaction(
    reference: string,
  ): Promise<NormalizedProviderTransaction> {
    this.assertReady();
    const response = await this.getPaystack(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    return this.normalizeTransaction(this.mapData(response), null);
  }

  retrieveTransactionStatus(reference: string) {
    return this.verifyTransaction(reference);
  }

  validateWebhookSignature(rawBody: Buffer, signature?: string): boolean {
    const key = this.secretKey();
    if (!key || !signature?.trim()) return false;
    const expected = createHmac('sha512', key).update(rawBody).digest('hex');
    const provided = signature.trim();
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(provided, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  parseWebhookEvent(payload: unknown): NormalizedWebhookEvent {
    const body = this.asRecord(payload);
    const event = this.requiredString(body.event);
    const data = this.asRecord(body.data);
    const eventId =
      this.optionalString(body.id) ??
      this.optionalString(data.id) ??
      `${event}:${this.requiredString(data.reference)}`;
    const recognized = [
      'charge.success',
      'charge.failed',
      'transfer.failed',
      'refund.processed',
    ].includes(event);
    return {
      event,
      eventId,
      transaction: recognized
        ? this.normalizeTransaction(data, eventId, event)
        : undefined,
    };
  }

  private async postPaystack(path: string, body: Record<string, unknown>) {
    return this.fetchPaystack(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private async getPaystack(path: string) {
    return this.fetchPaystack(path, { method: 'GET' });
  }

  private async fetchPaystack(
    path: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.secretKey()}`,
          'Content-Type': 'application/json',
        },
      });
      const parsed = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new BadGatewayException({
          code: 'PAYSTACK_PROVIDER_ERROR',
          message: 'Payment provider request failed.',
        });
      }
      return parsed;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException({
        code: 'PAYSTACK_PROVIDER_UNAVAILABLE',
        message: 'Payment provider is temporarily unavailable.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeTransaction(
    data: Record<string, unknown>,
    eventId: string | null,
    event?: string,
  ): NormalizedProviderTransaction {
    const statusText = this.optionalString(data.status)?.toLowerCase();
    const status =
      event === 'refund.processed'
        ? PaymentTransactionStatus.REFUNDED
        : statusText === 'success'
          ? PaymentTransactionStatus.PAID
          : statusText === 'failed' || event === 'charge.failed'
            ? PaymentTransactionStatus.FAILED
            : PaymentTransactionStatus.PENDING;
    const metadata = this.asRecord(data.metadata);
    return {
      provider: this.provider,
      environment: this.environment,
      providerReference: this.requiredString(data.reference),
      internalReference: this.requiredString(data.reference),
      status,
      amountMinor: Number(data.amount ?? 0),
      currency: this.requiredString(data.currency).toUpperCase(),
      paidAt: this.parseDate(data.paid_at ?? data.paidAt),
      eventId,
      metadata: this.sanitizeMetadata(metadata),
    };
  }

  private mapData(response: unknown) {
    const body = this.asRecord(response);
    if (body.status !== true) {
      throw new BadGatewayException({
        code: 'PAYSTACK_PROVIDER_ERROR',
        message: 'Payment provider returned an unsuccessful response.',
      });
    }
    return this.asRecord(body.data);
  }

  private sanitizeMetadata(metadata: Record<string, unknown>) {
    return {
      organizationId: this.optionalString(metadata.organizationId) ?? null,
      planCode: this.optionalString(metadata.planCode) ?? null,
      internalReference:
        this.optionalString(metadata.internalReference) ?? null,
    };
  }

  private secretKey() {
    return process.env.PAYSTACK_SECRET_KEY?.trim() ?? '';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private requiredString(value: unknown) {
    const text = this.optionalString(value);
    if (!text) {
      throw new BadGatewayException({
        code: 'PAYSTACK_RESPONSE_MALFORMED',
        message: 'Payment provider response was incomplete.',
      });
    }
    return text;
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private parseDate(value: unknown) {
    const text = this.optionalString(value);
    if (!text) return null;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
