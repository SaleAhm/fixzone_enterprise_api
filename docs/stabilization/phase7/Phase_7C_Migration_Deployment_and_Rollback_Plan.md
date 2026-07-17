# Phase 7C Migration, Deployment, and Rollback Plan

Date: 2026-07-17

## Migration Under Review

`prisma/migrations/20260717100000_phase7b_invitations_report_discussions/migration.sql`

## Migration Analysis

The migration is additive:

- Adds enum value `DECLINED` to `InvitationStatus`.
- Adds nullable columns to `Invitation`:
  - `declinedAt TIMESTAMP(3)`
  - `tokenHash TEXT`
  - `resentAt TIMESTAMP(3)`
  - `lastNotificationAt TIMESTAMP(3)`
- Adds index:
  - `Invitation_tokenHash_idx` on `Invitation(tokenHash)`
- Creates table `ReportMessage` if absent:
  - `id TEXT NOT NULL` primary key
  - `reportId TEXT NOT NULL`
  - `organizationId TEXT NOT NULL`
  - `authorId TEXT NOT NULL`
  - `authorRole UserRole NOT NULL`
  - `authorName TEXT NULL`
  - `message TEXT NOT NULL`
  - `metadata JSONB NULL`
  - `createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  - `updatedAt TIMESTAMP(3) NOT NULL`
- Adds indexes:
  - `ReportMessage_reportId_createdAt_idx`
  - `ReportMessage_organizationId_createdAt_idx`
  - `ReportMessage_authorId_createdAt_idx`
- Adds foreign keys:
  - `ReportMessage.reportId -> Report.id ON DELETE CASCADE ON UPDATE CASCADE`
  - `ReportMessage.authorId -> User.id ON DELETE CASCADE ON UPDATE CASCADE`

Compatibility:

- Existing production rows are compatible because all new `Invitation` columns are nullable.
- `ReportMessage` is a new table and requires no backfill.
- New enum value is additive, but PostgreSQL enum alterations should still be treated as migration operations requiring backup and maintenance-window awareness.
- Index creation is non-concurrent in the migration. Tables are expected to be small for invitations and empty for `ReportMessage`, but production size must be checked before execution.
- No unique constraints are added beyond existing schema constraints; duplicate production invitation data should not violate this migration.
- Rollback after production use would require preserving data-bearing `Invitation` columns and `ReportMessage` rows. Dropping them is not recommended once users create invitation/report-message data.
- Retry safety is partly improved by `IF NOT EXISTS`; however, foreign key `ADD CONSTRAINT` statements do not use `IF NOT EXISTS`, so a partially applied manual rerun could conflict. Prisma migration history should be the source of truth.

## Disposable Database Verification

Not completed in this audit. A fresh disposable PostgreSQL database was not provisioned, and the user's operational local database was not used destructively. Backend validation became blocked after `npm ci` failed and left dependencies incomplete.

Required before production:

1. Create disposable PostgreSQL database.
2. Apply the currently deployed production baseline migrations.
3. Run `npx prisma migrate deploy` to apply Phase 7B.
4. Start backend against disposable database.
5. Verify invitation persistence and report-message persistence.
6. Record migration logs and schema verification.
7. Drop the disposable database only after evidence is captured.

## Production Database Pre-flight Requirements

Hard stop: do not run production migration unless a recent verified backup and restore-test evidence exist.

Mandatory checks:

- Current production migration status: `npx prisma migrate status`
- Pending migrations: confirm only expected Phase 7B migration is pending.
- Database size and largest relations.
- Available disk/storage headroom.
- Active connection count.
- Long-running transactions.
- Locks on `Invitation`, `Report`, and `User`.
- Recent backup timestamp.
- Backup integrity verification.
- Restore-test evidence and owner sign-off.
- Maintenance-window approval.
- Migration log capture location.
- Post-migration schema verification.
- Application rollback image/revision availability.

Example read-only/pre-flight SQL:

```sql
select now();
select count(*) from "_prisma_migrations";
select * from pg_stat_activity where state <> 'idle';
select pg_size_pretty(pg_database_size(current_database()));
select relname, pg_size_pretty(pg_total_relation_size(relid))
from pg_catalog.pg_statio_user_tables
order by pg_total_relation_size(relid) desc
limit 20;
```

## Exact Migration Command Plan

Do not execute until release authorization:

```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

Application startup after migration:

```bash
npm run start:prod
```

## Deployment Compatibility Matrix

| Combination | Expected result | Risk |
| --- | --- | --- |
| Old Flutter + old backend + old database | Current production baseline | No Phase 7B features. |
| Old Flutter + new backend + migrated database | Should remain compatible | Additive routes/tables should not break old clients. |
| New Flutter + old backend + old database | Not safe | New invitation/report-discussion routes may 404 or fail. |
| New backend + old database before migration | Not safe for Phase 7B routes | Backend references `ReportMessage` and new Invitation fields; affected routes can fail. Startup may succeed until routes execute. |
| New backend + migrated database + new Flutter | Target state | Requires smoke testing. |
| Rolling backend deployment before migration | Not recommended | New code can receive requests before required tables/columns exist. |

Recommended sequencing requires database migration before exposing new backend code to Phase 7B traffic, or a tightly controlled maintenance deployment where backend is updated immediately after successful migration and Flutter is deployed after backend health checks.

## Recommended Deployment Order

1. Verify production backup and restore-test evidence.
2. Confirm production migration status and pending migration list.
3. Announce maintenance window if required.
4. Build backend image from `297f7a07a7c89bce744a81dcae250e0c765bde9a`.
5. Put new backend traffic behind deployment control, if available.
6. Run `npx prisma migrate deploy` and capture logs.
7. Verify schema and backend health.
8. Activate backend revision.
9. Run authenticated backend smoke tests with approved test accounts.
10. Build and deploy Flutter web from `ce454ff15a60885a71398d72d384a693fa08d9ee`.
11. Run controlled Flutter smoke tests.
12. Monitor logs, 5xx rate, auth failures, migration errors, invitation errors, notification errors, and report-message errors for at least 60 minutes.

## Production Smoke-test Matrix

Public/read-only:

- Website loads.
- API health endpoint responds.
- Public metrics respond read-only.
- Flutter gateway loads.

Citizen:

- Login.
- Dashboard.
- Reports.
- Report details.
- Notification navigation.
- Pending invitations list.
- Report discussion on owned report.

Provider:

- Login.
- Assigned jobs.
- Job details.
- Evidence visibility.
- Report discussion on assigned job.
- Profile/dashboard organization context.

Organization Admin:

- Organization name/context.
- Dashboard.
- Invitation creation.
- Pending invitation status.
- Resend/revoke.
- Dispatch.
- Reports.
- Trust Center read/update.
- Users/providers.

Super Admin:

- Platform scope.
- Organizations.
- Users.
- Providers.
- Monetization.
- Global authorization boundaries.

State-changing smoke tests must use approved reversible test records with named cleanup owners. No destructive production tests are authorized by this document.

## Rollback Triggers

- Backend startup failure.
- Migration failure or unexpected migration drift.
- Elevated 5xx rate.
- Authentication or role regression.
- Cross-tenant authorization defect.
- Invitation acceptance failure.
- Report discussion data exposure.
- Upload/evidence regression.
- Report workflow regression.
- Notification navigation/read-state regression.
- Trust Center enforcement update failure.

## Rollback Procedure

Backend rollback:

1. Restore previous backend image/revision.
2. Verify API health.
3. Verify old backend remains compatible with additive Phase 7B tables/columns.
4. Monitor errors and auth failures.

Flutter rollback:

1. Restore previous web revision/assets.
2. Invalidate or refresh caches as needed.
3. Verify service-worker asset version behavior.
4. Confirm gateway and role shells load.

Database rollback:

- Prefer forward-compatible rollback: leave additive Phase 7B tables/columns in place.
- Do not drop `ReportMessage` or new invitation fields after production data exists unless explicitly approved.
- If data corruption or destructive migration failure occurs, restore from verified backup.
- Recovery point objective equals time between verified backup and failure plus any accepted data loss window.
- Data created between deployment and rollback, especially invitations and report messages, must be preserved or explicitly reconciled.

## Monitoring Period

Minimum observation after deployment: 60 minutes, with explicit checks for:

- API 5xx rates.
- Auth 401/403 spikes.
- Prisma errors.
- Invitation conflicts and acceptance failures.
- Report discussion 403/404/500 rates.
- Notification creation failures.
- Flutter web asset/service-worker errors.
- Database connection saturation.

## Current Audit Conclusion

Deployment is blocked until backend validation is rerun successfully in a clean dependency environment, Flutter release build completes successfully, and production database pre-flight evidence is captured.

## Phase 7C-C Validation and Deployment-Readiness Update

Date: 2026-07-17

The local validation blockers named above are resolved:

- Clean backend dependency installation completed successfully with `npm ci`.
- Prisma validation and generation completed successfully.
- Backend build completed successfully after Prisma Client generation.
- Backend unit/integration and e2e test suites passed.
- Flutter release web build completed successfully and generated `build\web`.

No database schema change was required for the Prisma build-resolution repair. No migration was created, edited, or applied. The migration under review remains `prisma/migrations/20260717100000_phase7b_invitations_report_discussions/migration.sql`.

Build-order update:

- Backend `npm run build` now runs `prisma generate` through `prebuild`.
- Prisma Client output remains the package-client path `node_modules/@prisma/client`.
- The ignored root `generated` artifact is excluded from Nest build compilation.

Updated deployment recommendation:

Recommendation: **GO WITH CONDITIONS**

The remaining production conditions are operational, not local-build blockers:

- Verify a recent production backup and restore-test evidence.
- Confirm production migration status and pending migration list.
- Confirm production database size, largest relations, available storage, active connections, long-running transactions, and relevant locks.
- Confirm production environment readiness without exposing secret values.
- Approve deployment window, rollback owner, migration log capture, and smoke-test accounts.
- Execute production deployment only after explicit authorization.
- Monitor API, auth, Prisma, invitation, report-discussion, notification, Flutter asset/service-worker, and database health after deployment.

Security note:

The dependency audit remains open. `npm audit --omit=dev` reports 25 production-tree findings, and the full audit reports 35 findings including 1 critical transitive `websocket-driver` finding. No audit fix was run in this tranche; address dependency remediation in a separate approved security tranche.

## Phase 7C-D Preflight Evidence Update

Date: 2026-07-17

Phase 7C-D did not execute production commands or migrations. It produced the deployment-authorization evidence checklist at:

`docs/stabilization/phase7/Phase_7C_Production_Preflight_Evidence_Checklist.md`

Migration readiness remains conditional:

- Local backend build/test validation is complete.
- The Phase 7B migration remains additive and unchanged.
- Production migration execution is not authorized until backup, restore-test, migration-status, disk, connection, lock, environment, rollback, and smoke-test evidence are provided.

Deployment-time ordering remains:

1. Verify production backup and restore-test evidence.
2. Capture production migration status.
3. Confirm backend revision `8ac1fe609ccabe82ddea2ba4235d68ef37af6e5c`.
4. Decide maintenance/traffic control.
5. Run `npx prisma migrate deploy` only during an authorized deployment window.
6. Capture migration logs and schema verification.
7. Activate backend and verify health.
8. Run smoke-test gate.
9. Promote Flutter only after backend readiness.

Recommendation: **READY WITH CONDITIONS** for deployment authorization review, not deployment execution.
