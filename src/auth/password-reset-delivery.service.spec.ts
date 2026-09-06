import { PasswordResetDeliveryService } from './password-reset-delivery.service';
import { PasswordResetDeliveryConfig } from './password-reset-delivery.config';

const config: PasswordResetDeliveryConfig = {
  enabled: true,
  provider: 'smtp',
  smtp: {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    username: 'smtp-user',
    password: 'unit-pass',
    from: 'SecureZone <no-reply@example.test>',
  },
  resetOrigin: 'https://app.example.test',
  resetPath: '/reset-password',
  timeoutMs: 100,
  retryAttempts: 1,
  cooldownSeconds: 120,
  dailyLimit: 5,
  testMode: false,
};

describe('PasswordResetDeliveryService', () => {
  const request = {
    userId: 'user-1',
    recipientEmail: 'recipient@example.test',
    token: 'opaque',
    expiresAt: new Date('2026-09-04T12:00:00.000Z'),
  };

  it('stays unavailable when disabled', async () => {
    const sendMail = jest.fn();
    const service = new PasswordResetDeliveryService(
      { ...config, enabled: false },
      () => ({ sendMail }),
    );

    await expect(service.deliver(request)).resolves.toMatchObject({
      delivered: false,
      status: 'DELIVERY_UNAVAILABLE',
      attempts: 0,
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('constructs the reset URL only inside the delivery boundary', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const service = new PasswordResetDeliveryService(config, () => ({
      sendMail,
    }));

    const result = await service.deliver({
      ...request,
      token: 'opaque token+slash/equals=',
    });

    expect(result).toMatchObject({
      delivered: true,
      status: 'DELIVERY_ACCEPTED',
      attempts: 1,
    });
    const [[message]] = sendMail.mock.calls as [
      [{ text: string; html: string }],
    ];
    const resetLink = message.text.match(
      /https:\/\/app\.example\.test\/#\/reset-password\?token=\S+/,
    )?.[0];
    expect(resetLink).toBeDefined();
    expect(resetLink).toContain(
      '/#/reset-password?token=opaque+token%2Bslash%2Fequals%3D',
    );
    expect(resetLink).not.toContain('opaque token+slash/equals=');
    const parsed = new URL(resetLink!);
    const resetRoute = new URL(parsed.hash.slice(1), 'https://app.local');
    expect(resetRoute.pathname).toBe('/reset-password');
    expect(resetRoute.searchParams.get('token')).toBe(
      'opaque token+slash/equals=',
    );
    expect(message.html).toContain('Recover account access');
    expect(JSON.stringify(result)).not.toContain('opaque token');
    expect(JSON.stringify(result)).not.toContain('/#/reset-password');
  });

  it.each(['/provider-login', '/admin-login'])(
    'adds allow-listed %s return route when supplied by the auth service',
    async (returnTo) => {
      const sendMail = jest.fn().mockResolvedValue({});
      const service = new PasswordResetDeliveryService(config, () => ({
        sendMail,
      }));

      await service.deliver({ ...request, returnTo });

      const [[message]] = sendMail.mock.calls as [
        [{ text: string; html: string }],
      ];
      expect(message.text).toContain(
        `/#/reset-password?token=opaque&returnTo=${encodeURIComponent(
          returnTo,
        )}`,
      );
      expect(message.html).toContain(
        `returnTo=${encodeURIComponent(returnTo)}`,
      );
    },
  );

  it('retries transient pre-acceptance failures and then succeeds', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValueOnce({ code: 'ETIMEDOUT' })
      .mockResolvedValueOnce({});
    const service = new PasswordResetDeliveryService(config, () => ({
      sendMail,
    }));

    await expect(service.deliver(request)).resolves.toMatchObject({
      delivered: true,
      status: 'DELIVERY_ACCEPTED',
      attempts: 2,
    });
  });

  it('does not retry permanent recipient failures', async () => {
    const sendMail = jest.fn().mockRejectedValue({ responseCode: 550 });
    const service = new PasswordResetDeliveryService(config, () => ({
      sendMail,
    }));

    await expect(service.deliver(request)).resolves.toMatchObject({
      delivered: false,
      status: 'DELIVERY_FAILED',
      attempts: 1,
      errorCategory: 'permanent',
    });
  });

  it('sanitizes configuration/authentication failures', async () => {
    const sendMail = jest.fn().mockRejectedValue({ code: 'EAUTH' });
    const service = new PasswordResetDeliveryService(config, () => ({
      sendMail,
    }));

    await expect(service.deliver(request)).resolves.toMatchObject({
      delivered: false,
      status: 'DELIVERY_CONFIGURATION_ERROR',
      attempts: 1,
      errorCategory: 'configuration',
    });
  });

  it('converts slow delivery to a timeout category', async () => {
    const sendMail = jest.fn(
      () => new Promise((resolve) => setTimeout(resolve, 250)),
    );
    const service = new PasswordResetDeliveryService(
      { ...config, retryAttempts: 0 },
      () => ({ sendMail }),
    );

    await expect(service.deliver(request)).resolves.toMatchObject({
      delivered: false,
      status: 'DELIVERY_TIMEOUT',
      attempts: 1,
      errorCategory: 'timeout',
    });
  });
});
