import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { loadPasswordResetDeliveryConfig } from './password-reset-delivery.config';
import type { PasswordResetDeliveryConfig } from './password-reset-delivery.config';

export type PasswordResetDeliveryRequest = {
  userId: string;
  recipientEmail: string | null;
  token: string;
  expiresAt: Date;
  returnTo?: string;
};

export type PasswordResetDeliveryResult = {
  delivered: boolean;
  status:
    | 'DELIVERY_UNAVAILABLE'
    | 'DELIVERY_ACCEPTED'
    | 'DELIVERY_FAILED'
    | 'DELIVERY_CONFIGURATION_ERROR'
    | 'DELIVERY_TIMEOUT';
  attempts: number;
  errorCategory?: string;
};

type MailTransport = {
  sendMail(message: {
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
};

type MailTransportFactory = (
  config: PasswordResetDeliveryConfig,
) => MailTransport;

export const PASSWORD_RESET_DELIVERY_CONFIG = 'PASSWORD_RESET_DELIVERY_CONFIG';
export const PASSWORD_RESET_TRANSPORT_FACTORY =
  'PASSWORD_RESET_TRANSPORT_FACTORY';

@Injectable()
export class PasswordResetDeliveryService {
  private readonly config: PasswordResetDeliveryConfig;

  constructor(
    @Optional()
    @Inject(PASSWORD_RESET_DELIVERY_CONFIG)
    config?: PasswordResetDeliveryConfig,
    @Optional()
    @Inject(PASSWORD_RESET_TRANSPORT_FACTORY)
    private readonly transportFactory: MailTransportFactory = defaultTransport,
  ) {
    this.config = config ?? loadPasswordResetDeliveryConfig();
  }

  isEnabled() {
    return this.config.enabled;
  }

  policy() {
    return {
      cooldownSeconds: this.config.cooldownSeconds,
      dailyLimit: this.config.dailyLimit,
    };
  }

  async deliver(
    request: PasswordResetDeliveryRequest,
  ): Promise<PasswordResetDeliveryResult> {
    if (!this.config.enabled || !request.recipientEmail) {
      return {
        delivered: false,
        status: 'DELIVERY_UNAVAILABLE',
        attempts: 0,
      };
    }

    const resetLink = this.buildResetLink(request.token, request.returnTo);
    const message = {
      from: this.config.smtp.from,
      to: request.recipientEmail,
      replyTo: this.config.smtp.replyTo,
      subject: 'SecureZone account recovery instructions',
      text: [
        'SecureZone received a request to recover access to an account.',
        '',
        `Use this link to set a new password before ${request.expiresAt.toISOString()}:`,
        resetLink,
        '',
        'If you did not request this, ignore this message.',
      ].join('\n'),
      html: [
        '<p>SecureZone received a request to recover access to an account.</p>',
        '<p>Use the recovery link to set a new password before it expires.</p>',
        `<p><a href="${escapeHtml(resetLink)}">Recover account access</a></p>`,
        '<p>If you did not request this, ignore this message.</p>',
      ].join(''),
    };

    if (this.config.testMode) {
      return {
        delivered: false,
        status: 'DELIVERY_UNAVAILABLE',
        attempts: 0,
      };
    }

    const transport = this.transportFactory(this.config);
    const maxAttempts = this.config.retryAttempts + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await withTimeout(
          transport.sendMail(message),
          this.config.timeoutMs,
          'PASSWORD_RESET_DELIVERY_TIMEOUT_MS',
        );
        return {
          delivered: true,
          status: 'DELIVERY_ACCEPTED',
          attempts: attempt,
        };
      } catch (error) {
        const category = deliveryErrorCategory(error);
        if (category === 'timeout' && attempt < maxAttempts) continue;
        if (category === 'transient' && attempt < maxAttempts) continue;
        return {
          delivered: false,
          status:
            category === 'timeout'
              ? 'DELIVERY_TIMEOUT'
              : category === 'configuration'
                ? 'DELIVERY_CONFIGURATION_ERROR'
                : 'DELIVERY_FAILED',
          attempts: attempt,
          errorCategory: category,
        };
      }
    }

    return {
      delivered: false,
      status: 'DELIVERY_FAILED',
      attempts: maxAttempts,
      errorCategory: 'unknown',
    };
  }

  private buildResetLink(token: string, returnTo?: string) {
    const resetRoute = new URL(this.config.resetPath, 'https://app.local');
    resetRoute.searchParams.set('token', token);
    if (returnTo) {
      resetRoute.searchParams.set('returnTo', returnTo);
    }

    const url = new URL(this.config.resetOrigin);
    url.hash = `${resetRoute.pathname}${resetRoute.search}`;
    return url.toString();
  }
}

function defaultTransport(config: PasswordResetDeliveryConfig): MailTransport {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.username,
      pass: config.smtp.password,
    },
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string) {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(name)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function deliveryErrorCategory(error: unknown) {
  if (
    error instanceof Error &&
    error.message === 'PASSWORD_RESET_DELIVERY_TIMEOUT_MS'
  ) {
    return 'timeout';
  }
  const record = error as { code?: unknown; responseCode?: unknown };
  const code = typeof record.code === 'string' ? record.code : '';
  const responseCode =
    typeof record.responseCode === 'number' ? record.responseCode : 0;
  if (code === 'EAUTH' || code === 'ECONFIG' || responseCode === 535) {
    return 'configuration';
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ESOCKET' ||
    code === 'ECONNECTION' ||
    responseCode === 421 ||
    responseCode === 450 ||
    responseCode === 451 ||
    responseCode === 452
  ) {
    return 'transient';
  }
  return 'permanent';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}

export function redactedResetIdentifier(value: string | null | undefined) {
  if (!value) return null;
  return createHash('sha256')
    .update(value.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);
}
