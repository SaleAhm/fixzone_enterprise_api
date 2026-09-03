const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const dockerfilePath = path.join(repoRoot, 'Dockerfile');
const dockerignorePath = path.join(repoRoot, '.dockerignore');
const packageJsonPath = path.join(repoRoot, 'package.json');
const prismaBuildConfigPath = path.join(
  repoRoot,
  'prisma.container-build.config.ts',
);

const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
const dockerignore = fs.readFileSync(dockerignorePath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const prismaBuildConfig = fs.readFileSync(prismaBuildConfigPath, 'utf8');

const prohibitedSecretNames = [
  'JWT_ACCESS_SECRET',
  'DATABASE_URL',
  'FIREBASE_SERVICE_ACCOUNT_PATH',
  'FIREBASE_PROJECT_ID',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'PAYSTACK_SECRET_KEY',
  'POSTGRES_PASSWORD',
  'PGPASSWORD',
];

const dockerfileLines = dockerfile
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), number: index + 1 }))
  .filter(({ line }) => line && !line.startsWith('#'));

const buildInstructionLines = dockerfileLines.filter(({ line }) =>
  /^(ARG|ENV|RUN)\b/i.test(line),
);

for (const { line, number } of buildInstructionLines) {
  for (const name of prohibitedSecretNames) {
    assert(
      !line.includes(name),
      `Dockerfile line ${number} must not reference ${name}: ${line}`,
    );
  }

  assert(
    !/\b[A-Z0-9_]*(SECRET|TOKEN|PASSWORD)\b/.test(line),
    `Dockerfile line ${number} must not reference secret-like variables: ${line}`,
  );

  assert(
    !/\b(PRIVATE_[A-Z0-9_]*KEY|[A-Z0-9_]*PRIVATE_KEY)\b/.test(line),
    `Dockerfile line ${number} must not reference private key variables: ${line}`,
  );
}

for (const { line, number } of dockerfileLines.filter(({ line }) =>
  /^(COPY|ADD)\b/i.test(line),
)) {
  assert(
    !/(\.env|service-?account|serviceAccount|credential|credentials|firebase.*\.json|\.pem\b|\.key\b|id_rsa|id_dsa|id_ecdsa|id_ed25519)/i.test(
      line,
    ),
    `Dockerfile line ${number} must not copy credential material: ${line}`,
  );
}

for (const { line, number } of buildInstructionLines) {
  assert(
    !/\bprisma\s+migrate\s+deploy\b/i.test(line),
    `Dockerfile line ${number} must not run migrations during image build: ${line}`,
  );
}

const requiredDockerignorePatterns = [
  '.git',
  '.env',
  '.env.*',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'logs',
  '*.log',
  'firebase-service-account*.json',
  'service-account*.json',
  'serviceAccount*.json',
  '*serviceAccountKey*.json',
  'uploads/report-completion',
  'uploads/report-evidence',
  'backups',
  '*.dump',
  '*.pem',
  '*.key',
];

for (const pattern of requiredDockerignorePatterns) {
  assert(
    dockerignore.split(/\r?\n/).some((line) => line.trim() === pattern),
    `.dockerignore must include ${pattern}`,
  );
}

for (const pattern of ['prisma', 'prisma/**', 'prisma/migrations', '*.sql']) {
  assert(
    !dockerignore.split(/\r?\n/).some((line) => line.trim() === pattern),
    `.dockerignore must not exclude required Prisma artifacts via ${pattern}`,
  );
}

assert.equal(packageJson.scripts['prestart:prod'], 'prisma migrate deploy');
assert.equal(packageJson.scripts['start:prod'], 'node dist/src/main.js');
assert.equal(packageJson.dependencies.prisma, '^7.6.0');

assert(
  /RUN\s+npx\s+prisma\s+generate\s+--config=prisma\.container-build\.config\.ts/i.test(
    dockerfile,
  ),
  'Dockerfile must generate Prisma client with the build-only config.',
);
assert(
  /CMD\s+\["npm",\s*"run",\s*"start:prod"\]/.test(dockerfile),
  'Dockerfile must preserve the production npm startup command.',
);
assert(
  /COPY\s+prisma\s+\.\/prisma/i.test(dockerfile),
  'Dockerfile must keep Prisma schema and migrations available at runtime.',
);
assert(
  !/datasource|process\.env|dotenv|url\s*:/i.test(prismaBuildConfig),
  'Prisma build config must not load environment variables or define a datasource URL.',
);
