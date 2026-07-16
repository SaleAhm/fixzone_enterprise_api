# Phase 7B-B Backup and Demo Stabilization Report

Date: 2026-07-16

Repository: `fixzone_enterprise_api`

Branch: `phase-4-platform-expansion`

Starting HEAD: `29094da99a2fb9cc9b1523fb26fa52bdfaa16c16`

## Objective

Investigate and stabilize historical backup creation and demo generation HTTP 500 failures without expanding scope into payments, exports, backup restore/download UI, frontend work, production infrastructure, migrations, or deployments.

## Initial repository state

- Branch: `phase-4-platform-expansion`
- Upstream: `origin/phase-4-platform-expansion`
- Ahead/behind: `0 / 0`
- Working tree: clean
- Node: `v22.19.0`
- npm: `10.9.3`

## Environment assumptions

- Validation used the configured local development/test backend environment.
- Database credentials were not printed or documented.
- Prisma schema validation and client generation passed before implementation.
- Jest commands were run sequentially with `--runInBand`.
- Flutter and website repositories were not touched.

## Workflow map: backup creation

- Endpoint: `POST /api/platform-tools/backups`
- Controller: `PlatformToolsController.createBackup`
- Guards: `JwtAuthGuard`, `RolesGuard`
- Required role: `SUPER_ADMIN`
- Rate limit tier: `HeavyJob`
- Service: `PlatformToolsService.createBackup`
- Directory: `backups` under repository runtime working directory
- Data source: Prisma reads organizations, users, reports, notifications, demo audit logs, and platform settings
- File format: JSON manifest/database snapshot
- Metadata record: `PlatformBackup`
- Audit: `DemoAuditLog` action `Backup Created`

## Workflow map: demo generation

- Endpoint: `POST /api/admin/platform-tools/demo-environment/generate`
- Controller: `DemoEnvironmentController.generate`
- Guards: `JwtAuthGuard`, `RolesGuard`
- Required role: `SUPER_ADMIN`
- Rate limit tier: `HeavyJob`
- Service: `DemoDataService.seed`
- Database writes: organizations, users, reports, notifications, demo audit logs
- Demo flags: `isDemo`, `demoBatchId`, `demoScenario`, `demoGeneratedAt`
- Demo evidence references: static `/uploads/demo/*.svg` assets
- Cleanup endpoint: `DELETE /api/admin/platform-tools/demo-environment/purge`

## Current defects reproduced

1. Backup creation was vulnerable to filename collision because filenames used second-level timestamps.
2. Demo generation was vulnerable to repeated-generation collisions because demo provider IDs were static (`DEMO-PRV-001`, etc.) while `User.providerId` is unique.
3. Demo phone generation was not batch-scoped and could collide during repeated rapid generation.

## Fixes implemented

1. Backup filenames now include an operation suffix from `randomUUID()`.
2. Demo provider IDs are now batch-scoped.
3. Demo phone numbers are now batch-derived.
4. Platform tools tests now clean backup files as well as metadata.
5. Focused regression tests were added for repeated backup creation and repeated demo generation.

## Validation results

Focused repeat validation:

- `npm test -- --runInBand test/demo-environment.e2e-spec.ts`: passed
- `npm test -- --runInBand test/platform-tools.e2e-spec.ts`: passed
- Same focused sequence repeated: passed

Full validation:

- `npm ci`: passed
- `npx prisma validate`: passed
- `npx prisma generate`: passed
- `npm run build`: passed
- `npm test -- --runInBand`: passed, 16 suites / 110 tests
- `npm run test:e2e -- --runInBand`: passed, 12 suites / 86 tests
- Second full sequential regression cycle:
  - `npm test -- --runInBand`: passed, 16 suites / 110 tests
  - `npm run test:e2e -- --runInBand`: passed, 12 suites / 86 tests

## Known warnings

- npm audit reports 35 vulnerabilities. No package changes were authorized in this tranche.
- npm install emits package deprecation warnings.
- `pg` emits a non-blocking deprecation warning around `client.query()` while already executing a query.

## Classification

`GO FOR PHASE 7B-C WITH CONDITIONS`

Condition: package vulnerability/deprecation review and the `pg` warning remain technical debt outside this tranche.

