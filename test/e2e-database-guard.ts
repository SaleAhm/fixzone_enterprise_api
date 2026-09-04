const AUTHORIZED_E2E_DATABASE_NAME = 'fixzone_auth_e2e_20260904';

export type E2eDatabaseGuardDecision = {
  databaseName: string;
};

function fail(message: string): never {
  throw new Error(`E2E database guard failed: ${message}`);
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '[::1]' ||
    normalized === '::1'
  );
}

export function validateE2eDatabaseUrl(
  rawUrl: string | undefined,
): E2eDatabaseGuardDecision {
  if (!rawUrl || rawUrl.trim().length === 0) {
    fail('E2E_DATABASE_URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    fail('E2E_DATABASE_URL is malformed');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    fail('E2E_DATABASE_URL must use PostgreSQL');
  }

  if (!isLocalHost(parsed.hostname)) {
    fail('E2E_DATABASE_URL must target a local host');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (databaseName !== AUTHORIZED_E2E_DATABASE_NAME) {
    fail('E2E_DATABASE_URL must target the authorized disposable database');
  }

  return { databaseName };
}

export function applyE2eDatabaseGuard(env: NodeJS.ProcessEnv): void {
  const decision = validateE2eDatabaseUrl(env.E2E_DATABASE_URL);
  env.DATABASE_URL = env.E2E_DATABASE_URL;

  console.info('e2e_database_guard=PASS');
  console.info(`e2e_database_name=${decision.databaseName}`);
}
