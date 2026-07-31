const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs
    .readFileSync(path.join(root, relativePath), 'utf8')
    .replace(/^\uFEFF/, '');
}

function assertIncludes(file, text, message) {
  assert(
    read(file).includes(text),
    `${message} (${file} must include ${JSON.stringify(text)})`,
  );
}

function assertNotIncludes(file, text, message) {
  assert(
    !read(file).includes(text),
    `${message} (${file} must not include ${JSON.stringify(text)})`,
  );
}

function controllerFiles() {
  const srcRoot = path.join(root, 'src');
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.controller.ts')) {
        files.push(path.relative(root, fullPath).replace(/\\/g, '/'));
      }
    }
  }

  walk(srcRoot);
  return files.sort();
}

const packageJson = JSON.parse(read('package.json'));
assert.strictEqual(
  packageJson.scripts['test:rules:static'],
  'node test/security-rules.static-test.cjs',
  'package.json must keep the backend static security validation command wired',
);

assertIncludes(
  'src/configure-app.ts',
  'new ValidationPipe',
  'Global validation must be enabled',
);
assertIncludes(
  'src/configure-app.ts',
  'whitelist: true',
  'Validation must strip unknown DTO fields',
);
assertIncludes(
  'src/configure-app.ts',
  'forbidNonWhitelisted: true',
  'Validation must reject unexpected DTO fields',
);
assertIncludes(
  'src/configure-app.ts',
  'app.enableCors',
  'CORS must be configured centrally',
);
assertIncludes(
  'src/configure-app.ts',
  'CORS_ORIGINS',
  'Production CORS must be driven by explicit origins',
);
assertIncludes(
  'src/configure-app.ts',
  'Internal server error',
  'Unhandled exceptions must avoid leaking raw error details',
);

assertIncludes(
  'src/security/rate-limit.module.ts',
  'APP_GUARD',
  'Throttling must be installed as a global guard',
);
for (const tier of [
  'Auth',
  'Registration',
  'Upload',
  'AdminMutation',
  'HeavyJob',
]) {
  assertIncludes(
    'src/security/rate-limit.constants.ts',
    `RateLimitTier.${tier}`,
    `Rate-limit tier ${tier} must exist`,
  );
}
assertIncludes(
  'src/auth/auth.controller.ts',
  '@EnterpriseRateLimit(RateLimitTier.Auth)',
  'Auth endpoints must be rate limited',
);
assertIncludes(
  'src/report/report.controller.ts',
  '@EnterpriseRateLimit(RateLimitTier.Upload)',
  'Evidence upload endpoints must be rate limited',
);

assertIncludes(
  'src/auth/auth.service.ts',
  'bcrypt.hash',
  'Passwords must be hashed before storage',
);
assertIncludes(
  'src/auth/auth.service.ts',
  'bcrypt.compare',
  'Passwords must be verified with bcrypt',
);
assertIncludes(
  'src/auth/auth.service.ts',
  "expiresIn: '1d'",
  'Access tokens must have an expiry',
);
assertIncludes(
  'src/auth/auth.service.ts',
  "user.accountStatus !== 'ACTIVE'",
  'Inactive accounts must be blocked at login',
);
assertIncludes(
  'src/auth/strategies/jwt.strategy.ts',
  'ignoreExpiration: false',
  'JWT validation must enforce token expiry',
);
assertIncludes(
  'src/auth/strategies/jwt.strategy.ts',
  'accountStatus',
  'JWT strategy must reload current account status from the database',
);

for (const file of [
  'src/report/report.controller.ts',
  'src/users/users.controller.ts',
  'src/organization/organization.controller.ts',
  'src/platform-tools/platform-tools.controller.ts',
  'src/governance/governance.controller.ts',
]) {
  assertIncludes(file, 'UseGuards', 'Protected controllers must use guards');
  assertIncludes(
    file,
    'JwtAuthGuard',
    'Protected controllers must require JWT auth',
  );
  assertIncludes(
    file,
    'RolesGuard',
    'Protected controllers must enforce roles',
  );
  assertIncludes(
    file,
    '@Roles(',
    'Protected controllers must declare allowed roles',
  );
}

assertIncludes(
  'src/report/report.service.ts',
  'report.organizationId !== user.organizationId',
  'Report service must enforce organization boundaries',
);
assertIncludes(
  'src/report/report.service.ts',
  'report.assignedProviderId !== userId',
  'Provider report actions must require assignment ownership',
);
assertIncludes(
  'src/users/users.service.ts',
  'assertInviteeMatches',
  'Invitation acceptance must verify intended recipient',
);
assertIncludes(
  'src/users/users.service.ts',
  'InvitationStatus.PENDING',
  'Invitations must be single-use pending records',
);
assertIncludes(
  'src/users/users.service.ts',
  'expiresAt && invitation.expiresAt <= new Date()',
  'Invitation expiry must be enforced',
);
assertIncludes(
  'src/users/users.service.ts',
  'providerOrganization.upsert',
  'Existing-provider membership activation must use an idempotent upsert',
);

assertIncludes(
  'src/security/upload-security.service.ts',
  'MAX_DECODED_IMAGE_BYTES = 5 * 1024 * 1024',
  'Decoded image upload size must be capped',
);
for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
  assertIncludes(
    'src/security/upload-security.service.ts',
    mime,
    `Upload security must allow expected MIME ${mime}`,
  );
}
assertIncludes(
  'src/security/upload-security.service.ts',
  'detectImageMime',
  'Uploads must verify file signatures',
);
assertIncludes(
  'src/security/upload-security.service.ts',
  'assertSafePathSegment',
  'Upload paths must reject unsafe path segments',
);
assertIncludes(
  'src/security/upload-security.service.ts',
  'assertInsideUploadRoot',
  'Upload paths must stay inside the upload root',
);
assertIncludes(
  'src/main.ts',
  "'/uploads/demo'",
  'Only demo uploads should remain publicly static',
);
assertIncludes(
  'src/main.ts',
  "dotfiles: 'deny'",
  'Static demo upload serving must deny dotfiles',
);
assertIncludes(
  'src/main.ts',
  'X-Content-Type-Options',
  'Static demo upload responses must set nosniff',
);
assertIncludes(
  'src/main.ts',
  'Content-Security-Policy',
  'Static demo upload responses must set a restrictive CSP',
);
assertNotIncludes(
  'src/main.ts',
  "app.use(\r\n    '/uploads',",
  'Private runtime evidence must not be served by the root uploads static route',
);
assertIncludes(
  'src/report/report.controller.ts',
  "@Get(':id/evidence/:fileName')",
  'Report evidence retrieval must use a guarded API endpoint',
);
assertIncludes(
  'src/report/report.controller.ts',
  "@Get(':id/completion-evidence/:fileName')",
  'Completion evidence retrieval must use a guarded API endpoint',
);

const envFiles = ['.env', '.env.local', '.env.production.local'];
for (const envFile of envFiles) {
  assertIncludes('.gitignore', envFile, `${envFile} must be ignored`);
}
assertIncludes(
  '.gitignore',
  '/uploads/report-completion/',
  'Runtime completion evidence uploads must be ignored',
);
assertIncludes(
  '.gitignore',
  '/uploads/report-evidence/',
  'Runtime report evidence uploads must be ignored',
);

for (const file of controllerFiles()) {
  const source = read(file);
  const isExplicitlyPublic =
    file === 'src/app.controller.ts' ||
    file === 'src/auth/auth.controller.ts' ||
    file === 'src/onboarding/onboarding.controller.ts' ||
    file === 'src/public/public.controller.ts' ||
    source.includes("@Get('maintenance/public')");
  if (isExplicitlyPublic) continue;

  assert(
    source.includes('@UseGuards') || source.includes('UseGuards('),
    `${file} must be guarded or explicitly classified as public`,
  );
}

const sourceFilesToScan = controllerFiles().concat([
  'src/auth/auth.service.ts',
  'src/auth/strategies/jwt.strategy.ts',
  'src/report/report.service.ts',
  'src/users/users.service.ts',
  'src/organization/organization.service.ts',
  'src/platform-tools/platform-tools.service.ts',
]);

for (const file of sourceFilesToScan) {
  assertNotIncludes(
    file,
    'console.log(',
    'Release source must avoid raw console.log debugging',
  );
  assertNotIncludes(
    file,
    'passwordHash: true',
    'API selects must not expose password hashes',
  );
}

console.log('Backend static security release checks passed.');
