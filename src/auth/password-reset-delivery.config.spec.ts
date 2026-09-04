import { loadPasswordResetDeliveryConfig } from './password-reset-delivery.config';

const enabledEnv = {
  PASSWORD_RESET_DELIVERY_ENABLED: 'true',
  PASSWORD_RESET_DELIVERY_PROVIDER: 'amazon-ses-smtp',
  PASSWORD_RESET_SMTP_HOST: 'email-smtp.example.test',
  PASSWORD_RESET_SMTP_PORT: '587',
  PASSWORD_RESET_SMTP_SECURE: 'false',
  PASSWORD_RESET_SMTP_USERNAME: 'smtp-user',
  PASSWORD_RESET_SMTP_PASSWORD: 'unit-pass',
  PASSWORD_RESET_SMTP_FROM: 'SecureZone <no-reply@example.test>',
  PASSWORD_RESET_PUBLIC_ORIGIN: 'https://app.example.test',
  PASSWORD_RESET_ALLOWED_ORIGINS: 'https://app.example.test',
};

describe('password reset delivery config', () => {
  it('is disabled by default', () => {
    expect(loadPasswordResetDeliveryConfig({}).enabled).toBe(false);
  });

  it('accepts a valid enabled SMTP configuration', () => {
    const config = loadPasswordResetDeliveryConfig(enabledEnv);

    expect(config.enabled).toBe(true);
    expect(config.provider).toBe('amazon-ses-smtp');
    expect(config.smtp.port).toBe(587);
    expect(config.resetOrigin).toBe('https://app.example.test');
    expect(config.retryAttempts).toBe(1);
  });

  it.each([
    ['PASSWORD_RESET_SMTP_HOST', ''],
    ['PASSWORD_RESET_DELIVERY_PROVIDER', 'mailgun'],
    ['PASSWORD_RESET_SMTP_PORT', '99999'],
    ['PASSWORD_RESET_SMTP_SECURE', 'sometimes'],
    ['PASSWORD_RESET_PUBLIC_ORIGIN', 'http://app.example.test'],
    ['PASSWORD_RESET_PUBLIC_ORIGIN', 'https://user:pass@app.example.test'],
    ['PASSWORD_RESET_PUBLIC_ORIGIN', 'https://app.example.test/reset'],
    ['PASSWORD_RESET_PUBLIC_ORIGIN', 'https://app.example.test/#token'],
    ['PASSWORD_RESET_ALLOWED_ORIGINS', 'https://other.example.test'],
    ['PASSWORD_RESET_SMTP_FROM', 'SecureZone\r\nBcc: attacker@example.test'],
  ])('rejects unsafe enabled config %s', (name, value) => {
    expect(() =>
      loadPasswordResetDeliveryConfig({
        ...enabledEnv,
        [name]: value,
      }),
    ).toThrow(name);
  });

  it('permits HTTP only for loopback development origins', () => {
    const config = loadPasswordResetDeliveryConfig({
      ...enabledEnv,
      PASSWORD_RESET_PUBLIC_ORIGIN: 'http://localhost:3000',
      PASSWORD_RESET_ALLOWED_ORIGINS: 'http://localhost:3000',
    });

    expect(config.resetOrigin).toBe('http://localhost:3000');
  });
});
