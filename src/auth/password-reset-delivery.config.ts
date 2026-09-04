export type PasswordResetDeliveryProvider =
  | 'smtp'
  | 'amazon-ses-smtp'
  | 'brevo-smtp';

export type PasswordResetDeliveryConfig = {
  enabled: boolean;
  provider: PasswordResetDeliveryProvider;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from: string;
    replyTo?: string;
  };
  resetOrigin: string;
  resetPath: '/reset-password';
  timeoutMs: number;
  retryAttempts: number;
  cooldownSeconds: number;
  dailyLimit: number;
  testMode: boolean;
};

const supportedProviders: PasswordResetDeliveryProvider[] = [
  'smtp',
  'amazon-ses-smtp',
  'brevo-smtp',
];

const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

export function loadPasswordResetDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): PasswordResetDeliveryConfig {
  if (env.PASSWORD_RESET_DELIVERY_ENABLED !== 'true') {
    return disabledConfig();
  }

  const provider = requiredName(
    env,
    'PASSWORD_RESET_DELIVERY_PROVIDER',
  ).toLowerCase();
  if (!supportedProviders.includes(provider as PasswordResetDeliveryProvider)) {
    throw configError('PASSWORD_RESET_DELIVERY_PROVIDER');
  }

  const publicOrigin = normalizePublicOrigin(
    requiredName(env, 'PASSWORD_RESET_PUBLIC_ORIGIN'),
  );
  const allowedOrigins = requiredName(env, 'PASSWORD_RESET_ALLOWED_ORIGINS')
    .split(',')
    .map((value) => normalizePublicOrigin(value.trim()))
    .filter(Boolean);
  if (!allowedOrigins.includes(publicOrigin)) {
    throw configError('PASSWORD_RESET_ALLOWED_ORIGINS');
  }

  return {
    enabled: true,
    provider: provider as PasswordResetDeliveryProvider,
    smtp: {
      host: safeHost(requiredName(env, 'PASSWORD_RESET_SMTP_HOST')),
      port: numberInRange(env, 'PASSWORD_RESET_SMTP_PORT', 1, 65_535),
      secure: booleanValue(env, 'PASSWORD_RESET_SMTP_SECURE'),
      username: requiredName(env, 'PASSWORD_RESET_SMTP_USERNAME'),
      password: requiredName(env, 'PASSWORD_RESET_SMTP_PASSWORD'),
      from: safeHeader(requiredName(env, 'PASSWORD_RESET_SMTP_FROM')),
      replyTo: optionalHeader(env.PASSWORD_RESET_SMTP_REPLY_TO),
    },
    resetOrigin: publicOrigin,
    resetPath: '/reset-password',
    timeoutMs: numberInRange(
      env,
      'PASSWORD_RESET_DELIVERY_TIMEOUT_MS',
      1_000,
      20_000,
      5_000,
    ),
    retryAttempts: numberInRange(
      env,
      'PASSWORD_RESET_DELIVERY_RETRY_ATTEMPTS',
      0,
      2,
      1,
    ),
    cooldownSeconds: numberInRange(
      env,
      'PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS',
      30,
      900,
      120,
    ),
    dailyLimit: numberInRange(
      env,
      'PASSWORD_RESET_REQUEST_DAILY_LIMIT',
      1,
      10,
      5,
    ),
    testMode: env.PASSWORD_RESET_DELIVERY_TEST_MODE === 'true',
  };
}

function disabledConfig(): PasswordResetDeliveryConfig {
  return {
    enabled: false,
    provider: 'smtp',
    smtp: {
      host: '',
      port: 587,
      secure: false,
      username: '',
      password: '',
      from: '',
    },
    resetOrigin: '',
    resetPath: '/reset-password',
    timeoutMs: 5_000,
    retryAttempts: 0,
    cooldownSeconds: 120,
    dailyLimit: 5,
    testMode: false,
  };
}

function requiredName(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value || isPlaceholder(value)) throw configError(name);
  if (hasControlCharacters(value)) throw configError(name);
  return value;
}

function numberInRange(
  env: NodeJS.ProcessEnv,
  name: string,
  min: number,
  max: number,
  fallback?: number,
) {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw configError(name);
  }
  if (!/^\d+$/.test(raw)) throw configError(name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw configError(name);
  }
  return value;
}

function booleanValue(env: NodeJS.ProcessEnv, name: string) {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw configError(name);
}

function safeHost(value: string) {
  if (value.includes('/') || value.includes('\\') || value.includes('@')) {
    throw configError('PASSWORD_RESET_SMTP_HOST');
  }
  return value.toLowerCase();
}

function safeHeader(value: string) {
  if (hasControlCharacters(value))
    throw configError('PASSWORD_RESET_SMTP_FROM');
  return value;
}

function optionalHeader(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (hasControlCharacters(trimmed) || isPlaceholder(trimmed)) {
    throw configError('PASSWORD_RESET_SMTP_REPLY_TO');
  }
  return trimmed;
}

function normalizePublicOrigin(value: string) {
  if (!value || hasControlCharacters(value)) {
    throw configError('PASSWORD_RESET_PUBLIC_ORIGIN');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configError('PASSWORD_RESET_PUBLIC_ORIGIN');
  }
  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw configError('PASSWORD_RESET_PUBLIC_ORIGIN');
  }
  if (parsed.pathname && parsed.pathname !== '/') {
    throw configError('PASSWORD_RESET_PUBLIC_ORIGIN');
  }
  if (parsed.protocol === 'http:') {
    if (!localHosts.has(parsed.hostname)) {
      throw configError('PASSWORD_RESET_PUBLIC_ORIGIN');
    }
  } else if (parsed.protocol !== 'https:') {
    throw configError('PASSWORD_RESET_PUBLIC_ORIGIN');
  }
  return parsed.origin;
}

function hasControlCharacters(value: string) {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function isPlaceholder(value: string) {
  return /^(change-?me|placeholder|replace|example|test)$/i.test(value);
}

function configError(name: string) {
  return new Error(`Password reset delivery configuration is invalid: ${name}`);
}
