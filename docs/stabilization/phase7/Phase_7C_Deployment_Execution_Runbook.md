# Phase 7C Deployment Execution Runbook

Date: 2026-07-17

Status: **PREPARED, NOT EXECUTED**

This runbook is for a future authorized deployment window. Do not execute it until Phase 7C-F final gates are satisfied and explicit deployment execution authorization is given.

## Gate 1: Release Confirmation

Stop unless all are true:

- Backend branch is `phase-4-platform-expansion`.
- Backend commit is `86bacc09d9ed14d76b22a2e69cda953d838114b8`.
- Flutter branch is `master`.
- Flutter commit is `ce454ff15a60885a71398d72d384a693fa08d9ee`.
- Website is unchanged at `0b705e79572d0d9955d760dcb64921419ea353ec`.
- Deployment owner assigned.
- Migration owner assigned.
- Rollback owner assigned.
- Smoke-test and cleanup owners assigned.
- Monitoring owner assigned.
- Deployment window approved.
- Temporary dependency risk acceptance finalized.

## Gate 2: Backup

Stop unless all are true:

- Fresh VPS backup completed successfully.
- Fresh database dump exists and has non-zero size.
- Fresh app/config/archive backup exists.
- Fresh manifest exists.
- SHA256 verification passed.
- Backup destination has sufficient free space.
- Off-site HPE ML30 replication completed successfully.
- Remote manifest, database dump, and SHA256 evidence match the fresh backup.
- Restore-test evidence is linked in the deployment record.

## Gate 3: Database Preflight

Run only read-only checks:

```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
```

Read-only SQL:

```sql
select now();
select version();
select current_database();
select count(*) from "_prisma_migrations";
select migration_name, started_at, finished_at, rolled_back_at, logs
from "_prisma_migrations"
order by started_at desc
limit 20;
select pg_size_pretty(pg_database_size(current_database()));
select count(*) as active_connections from pg_stat_activity where state <> 'idle';
show max_connections;
select pid, usename, state, now() - xact_start as xact_age, query
from pg_stat_activity
where xact_start is not null
order by xact_start asc
limit 20;
select relation::regclass, mode, granted, count(*)
from pg_locks
where relation is not null
group by relation, mode, granted
order by count(*) desc;
select relname, pg_size_pretty(pg_total_relation_size(relid))
from pg_catalog.pg_statio_user_tables
where relname in ('Invitation', 'ReportMessage', 'Report', 'User', 'Organization')
order by pg_total_relation_size(relid) desc;
```

Stop on:

- Failed migration record.
- Unexpected schema drift.
- Unexpected pending migrations.
- Unsafe locks or long-running transactions.
- Insufficient disk or connection headroom.

## Gate 4: Migration

Execute only after Gates 1-3 pass and explicit authorization is present.

```bash
npx prisma migrate deploy
```

Capture:

- Full command output.
- Start/end timestamps.
- Exit code.
- Migration status after execution.
- Schema verification for `Invitation` and `ReportMessage`.

Stop on failure. Do not manually edit `_prisma_migrations`.

## Gate 5: Backend

Deploy exact backend revision:

`86bacc09d9ed14d76b22a2e69cda953d838114b8`

Confirm build behavior:

```text
prebuild -> prisma generate
build -> nest build
```

After deployment:

- Verify backend health endpoint.
- Inspect startup logs.
- Confirm no Prisma startup errors.
- Confirm uploads mount is present.
- Confirm CORS and API routes behave as expected.
- Run backend smoke tests.

Stop on startup failure, repeated health failure, Prisma errors, or auth regression.

## Gate 6: Flutter

Deploy exact Flutter revision:

`ce454ff15a60885a71398d72d384a693fa08d9ee`

After deployment:

- Verify `index.html` loads.
- Verify compiled main bundle loads.
- Verify assets manifest loads.
- Verify service worker/cache behavior.
- Confirm API base URL targets production API.
- Run Flutter smoke tests.

Stop on frontend load failure, stale API target, broken auth route, or service-worker cache failure.

## Gate 7: Monitoring

Observe for at least 60 minutes.

Monitor:

- Backend health.
- HTTP 4xx and 5xx rates.
- Authentication failures.
- Prisma/database errors.
- Migration errors.
- Report creation and assignment.
- Upload/evidence failures.
- Invitation actions.
- Report discussion actions.
- Notification failures.
- CPU, memory, disk, and DB connections.
- Service restarts.
- Flutter asset and service-worker errors.

Release acceptance decision:

- Accept only if health, smoke tests, and monitoring are clean.
- Roll back if any trigger fires and rollback owner approves.

## Rollback Triggers

- Migration failure.
- Backend startup failure.
- Repeated health-check failure.
- Abnormal 5xx increase.
- Authentication regression.
- Cross-tenant access.
- Invitation privilege escalation.
- Report-discussion exposure.
- Notification routing failure with material impact.
- Upload/evidence regression.
- Assignment/completion/closure regression.
- Database lock or connection exhaustion.

## Rollback Notes

- Roll back backend and Flutter application revisions first.
- Keep additive Phase 7B database objects in place after application rollback.
- Do not drop data-bearing `ReportMessage` or invitation columns after use.
- Restore database only for severe migration corruption or data exposure.
