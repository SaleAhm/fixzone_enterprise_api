# Phase 7C-A — Migration, Deployment, and Rollback Plan

Date: 2026-07-17  
Deployment authorization: **not granted**

## 1. Migration Under Review

Migration:

```text
prisma/migrations/20260717100000_phase7b_invitations_report_discussions/migration.sql
```

Related schema areas:

- `InvitationStatus`
- `Invitation`
- `ReportMessage`
- `User.reportMessages`
- `Report.messages`

## 2. Migration Safety Analysis

The migration is additive.

### Created enum value

- Adds `DECLINED` to `InvitationStatus`.

### Created invitation columns

Nullable columns:

- `declinedAt`
- `tokenHash`
- `resentAt`
- `lastNotificationAt`

These are nullable and preserve existing rows.

### Created indexes

- `Invitation_tokenHash_idx`

### Created table

`ReportMessage`

Columns:

- `id` — primary key, default `cuid()`.
- `reportId` — required.
- `organizationId` — required.
- `authorId` — required.
- `authorRole` — required enum `UserRole`.
- `authorName` — nullable.
- `message` — required text.
- `metadata` — nullable JSON.
- `createdAt` — default current timestamp.
- `updatedAt` — auto-updated timestamp.

Indexes:

- `ReportMessage_reportId_createdAt_idx`
- `ReportMessage_organizationId_createdAt_idx`
- `ReportMessage_authorId_createdAt_idx`

Foreign keys:

- `ReportMessage_reportId_fkey` references `Report(id)` with `ON DELETE CASCADE`.
- `ReportMessage_authorId_fkey` references `User(id)` with `ON DELETE CASCADE`.

Compatibility:

- Existing production reports and users require no backfill.
- Existing invitation rows remain valid.
- No existing columns are dropped or renamed.
- No non-nullable column is added to an existing table.
- No destructive SQL is present.

Lock risk:

- Enum alteration and nullable column additions should be brief.
- New table creation should not lock existing high-write tables for long.
- Index creation on the new table is low risk because it starts empty.

Retry considerations:

- `ALTER TYPE ... ADD VALUE IF NOT EXISTS` is retry-friendly on supported PostgreSQL versions.
- `ADD COLUMN IF NOT EXISTS` is retry-friendly.
- Table creation uses `CREATE TABLE IF NOT EXISTS`.
- Constraint creation may not be fully idempotent if the table exists but constraints already exist outside normal Prisma migration history. Normal Prisma migration execution applies the file once and should not retry partial manual executions.

Rollback considerations:

- After production use, dropping `ReportMessage` or new invitation metadata columns would lose data.
- Preferred rollback is application rollback while retaining additive database objects.
- Database restore should be reserved for severe migration corruption or data exposure incidents.

## 3. Production Database Pre-Flight Requirements

Hard stop if any item cannot be confirmed:

1. Recent verified production backup exists.
2. Backup integrity is confirmed.
3. Restore-test evidence exists or emergency restore owner accepts documented risk.
4. Current `_prisma_migrations` state is captured.
5. Pending migrations are listed before deployment.
6. Database size and available storage are captured.
7. Active connection count is reviewed.
8. Long-running transactions are checked.
9. Migration log capture is prepared.
10. Post-migration schema verification commands are prepared.

Recommended read-only production pre-flight SQL:

```sql
SELECT migration_name, finished_at
FROM "_prisma_migrations"
ORDER BY finished_at DESC;
```

```sql
SELECT count(*) AS active_connections
FROM pg_stat_activity
WHERE state = 'active';
```

```sql
SELECT pid, now() - xact_start AS age, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY age DESC
LIMIT 10;
```

## 4. Production Migration Command Plan

Do not execute until release authorization is granted.

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

Post-migration checks:

```sql
SELECT to_regclass('public."ReportMessage"') AS report_message_table;
```

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'Invitation'
  AND column_name IN ('declinedAt', 'tokenHash', 'resentAt', 'lastNotificationAt');
```

## 5. Compatibility Matrix

| Combination | Assessment |
| --- | --- |
| Old Flutter + old backend | Current production baseline. |
| Old Flutter + new backend before migration | Risk: backend references new Prisma model in report-message routes; startup may work, but invoking new routes without table would fail. Existing old Flutter flows should not call new routes. |
| New Flutter + old backend | Not safe for invitation/report-discussion UI; new routes would return 404. Deploy backend first. |
| New backend + migrated database + old Flutter | Safe for existing flows; additive routes remain unused by old Flutter. |
| New backend + migrated database + new Flutter | Intended Phase 7B runtime. |

## 6. Recommended Deployment Order

This order is conditional on fresh validation passing:

1. Verify production backup and restore evidence.
2. Confirm production migration state.
3. Deploy backend build/revision.
4. Run backend health check.
5. Apply Prisma migration if not applied as part of backend deployment process.
6. Verify `ReportMessage` table and invitation columns.
7. Smoke-test existing authentication and report workflows.
8. Deploy Flutter web build/revision.
9. Run authenticated smoke tests.
10. Monitor logs and metrics during the release observation window.

If Dokploy deployment process runs migrations separately, ensure the backend does not expose new UI-dependent routes to new Flutter before migration is complete.

## 7. Smoke-Test Matrix

### Public/read-only

- Website loads.
- API health responds.
- Public metrics respond.
- Flutter gateway loads.

### Citizen

- Login.
- Dashboard.
- Reports list.
- Report details.
- Notification navigation.
- Pending invitations panel.
- Report discussion on owned report.

### Provider

- Login.
- Assigned jobs.
- Job details.
- Evidence visibility.
- Report discussion on assigned job.
- Profile/dashboard.

### Organization Admin

- Organization dashboard.
- Invitation creation.
- Pending invitation status.
- Resend/revoke.
- Dispatch.
- Reports.
- Trust Center read/update.
- Users/providers.

### Super Admin

- Platform scope.
- Organizations.
- Users.
- Providers.
- Monetization.
- Global authorization boundaries.

State-changing production smoke tests must use approved test accounts and reversible test records with cleanup ownership assigned before execution.

## 8. Rollback Triggers

Rollback or pause release if any occurs:

- Backend startup failure.
- Migration failure.
- Elevated 5xx rate.
- Authentication regression.
- Cross-tenant authorization defect.
- Invitation acceptance privilege escalation.
- Report-discussion data exposure.
- Upload/evidence regression.
- Report assignment/workflow regression.
- Completion/citizen review regression.
- Trust Center update regression.

## 9. Rollback Procedure

### Backend

1. Restore previous backend image/revision.
2. Verify health endpoint.
3. Verify existing report and auth workflows.
4. Leave additive Phase 7B database structures in place unless data corruption or data exposure requires restore.

### Flutter

1. Restore previous web revision/assets.
2. Verify service worker/cache behavior.
3. Instruct testers to hard refresh if stale assets persist.

### Database

Preferred:

- Keep additive tables/columns.
- Roll application backward.

Avoid:

- Dropping `ReportMessage` or invitation metadata after production use.

Use database restore only if:

- Migration corrupts production schema.
- Unauthorized data exposure occurs.
- Recovery point objective impact is approved.

## 10. Current Plan Status

The migration appears additive and production-compatible by source review, but deployment planning remains **blocked** until fresh backend and Flutter validation can be completed successfully.
