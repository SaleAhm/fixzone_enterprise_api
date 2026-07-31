const DEVELOPMENT_JWT_ACCESS_SECRET = 'fixzone_local_development_jwt_secret';

const productionLikeEnvironments = new Set(['production', 'staging']);

const insecureJwtSecrets = new Set([
  'fixzone_access_secret',
  'change-me',
  'changeme',
  'secret',
  'default',
  'jwt_secret',
  'jwt-access-secret',
]);

export function getJwtAccessSecret(env: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  const configuredSecret = env.JWT_ACCESS_SECRET;
  const trimmedSecret = configuredSecret?.trim() ?? '';

  if (trimmedSecret.length > 0) {
    assertProductionSafeJwtSecret(trimmedSecret, nodeEnv);
    return trimmedSecret;
  }

  if (nodeEnv === '' || nodeEnv === 'development' || nodeEnv === 'test') {
    return DEVELOPMENT_JWT_ACCESS_SECRET;
  }

  throw new Error(
    'JWT_ACCESS_SECRET is required for staging and production environments.',
  );
}

function assertProductionSafeJwtSecret(secret: string, nodeEnv: string) {
  if (!productionLikeEnvironments.has(nodeEnv)) return;

  const normalized = secret.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    insecureJwtSecrets.has(normalized) ||
    normalized.includes('change-me') ||
    normalized.includes('changeme') ||
    normalized.includes('placeholder')
  ) {
    throw new Error(
      'JWT_ACCESS_SECRET must be set to a non-placeholder value for staging and production environments.',
    );
  }
}
