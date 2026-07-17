# Phase 7C Production Preflight Evidence Checklist

Date: 2026-07-17

## Scope

This checklist defines the evidence required before deployment authorization. No production commands were executed in Phase 7C-D. No production services, databases, backups, Dokploy configuration, DNS, SSL, secrets, Firebase production settings, CI/CD, branches, or tags were changed.

## Current Candidate Revisions

| Repository | Branch | Commit | Status |
| --- | --- | --- | --- |
| Backend | `phase-4-platform-expansion` | `8ac1fe609ccabe82ddea2ba4235d68ef37af6e5c` | LOCALLY VERIFIED |
| Flutter | `master` | `ce454ff15a60885a71398d72d384a693fa08d9ee` | LOCALLY VERIFIED |
| Website | `main` | `0b705e79572d0d9955d760dcb64921419ea353ec` | UNCHANGED |

## Backup Evidence Status

| Evidence | Status | Required proof |
| --- | --- | --- |
| Latest production backup timestamp | EVIDENCE REQUIRED | Screenshot or log excerpt showing successful latest backup time. |
| Latest optimized cron backup result | EVIDENCE REQUIRED | Cron/systemd timer status and latest backup log. |
| Backup manifest generation | EVIDENCE REQUIRED | Latest manifest filename, timestamp, and checksum/size summary. |
| Database dump presence | EVIDENCE REQUIRED | Dump filename, timestamp, and non-zero size. |
| Volume/config backup presence | EVIDENCE REQUIRED | Archive names and sizes. |
| Off-site replication to HPE ML30 | EVIDENCE REQUIRED | Replication log or destination listing. |
| Uptime Kuma/monitoring confirmation | EVIDENCE REQUIRED | Dashboard screenshot or alert history showing healthy backup/host checks. |
| Retention status | EVIDENCE REQUIRED | Listing showing expected retained backups and pruning status. |
| Latest restore test | EVIDENCE REQUIRED | Date, target, operator, and successful restore result. |

Mandatory hard stop: deployment must not be authorized without a recent verified production backup and credible restore-test evidence.

## Authorized Operator VPS Checklist

Run later only by an authorized operator on the VPS. These are read-only or inspection commands except integrity tests that read archive contents.

```bash
date
timedatectl
df -h
du -sh /path/to/backups
ls -lah /path/to/backups | tail -n 20
find /path/to/backups -maxdepth 2 -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort | tail -n 30
tail -n 200 /path/to/backup/log
crontab -l
systemctl list-timers --all | grep -i backup
systemctl status <backup-service-or-timer>
```

Database dump and manifest checks:

```bash
ls -lah /path/to/latest/database-dump*
ls -lah /path/to/latest/*manifest*
sha256sum /path/to/latest/*manifest*
gzip -t /path/to/latest/*.gz
tar -tf /path/to/latest/*.tar | head
```

Replication checks:

```bash
tail -n 200 /path/to/replication/log
rsync --dry-run --itemize-changes /path/to/latest/ user@home-server:/replication/path/
```

## Authorized Operator Home Server Checklist

Run later only by an authorized operator on the HPE ML30/home server.

```bash
date
timedatectl
df -h
ls -lah /replication/path | tail -n 20
find /replication/path -maxdepth 2 -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort | tail -n 30
ls -lah /replication/path/latest/*manifest*
ls -lah /replication/path/latest/database-dump*
sha256sum /replication/path/latest/*manifest*
systemctl status <replication-or-monitoring-service>
```

Restore-test proof required:

- Restore date.
- Restore target host/database.
- Source backup identifier.
- Migration count after restore.
- Application health result against restored target.
- Operator and reviewer sign-off.

## Production Database Preflight

Do not run write queries. Do not run `npx prisma migrate deploy` in this phase.

Read-only SQL for authorized operator:

```sql
select now();
select version();
select current_database();
select count(*) from "_prisma_migrations";
select migration_name, finished_at, rolled_back_at, logs
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

Prisma migration status commands for authorized operator:

```bash
git rev-parse HEAD
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
```

Do not continue if migration history is inconsistent, a migration is failed, a destructive drift warning appears, or more than the expected Phase 7B migration is pending.

## Phase 7B Migration Readiness

Migration under review:

`prisma/migrations/20260717100000_phase7b_invitations_report_discussions/migration.sql`

Expected operations:

- Add `DECLINED` to `InvitationStatus`.
- Add nullable invitation columns: `declinedAt`, `tokenHash`, `resentAt`, `lastNotificationAt`.
- Add `Invitation_tokenHash_idx`.
- Create `ReportMessage`.
- Add `ReportMessage` indexes.
- Add `ReportMessage.reportId` and `ReportMessage.authorId` foreign keys.

Recommended sequence:

1. Confirm backup and restore-test evidence.
2. Capture migration status before deploy.
3. Activate maintenance/traffic control if available.
4. Run migration before exposing the new backend to Phase 7B traffic.
5. Activate backend after successful migration.
6. Promote Flutter only after backend health and smoke-test gate.

## Environment Readiness

| Variable / area | Status | Secret | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | PRODUCTION PRESENCE UNVERIFIED | Yes | Required by Prisma and `PrismaService`. |
| `JWT_ACCESS_SECRET` | PRODUCTION PRESENCE UNVERIFIED | Yes | Required; local module has insecure fallback, so production value must be confirmed. |
| `PORT` | OPTIONAL | No | Defaults to `3000`. |
| `NODE_ENV` | PRODUCTION PRESENCE UNVERIFIED | No | Should be `production`. |
| `CORS_ORIGINS` | PRODUCTION PRESENCE UNVERIFIED | No | Should include approved frontend origins only. |
| `TRUST_PROXY` | PRODUCTION PRESENCE UNVERIFIED | No | Required behind trusted proxy if rate-limit client IP must use forwarded headers. |
| `DEFAULT_ORGANIZATION_NAME` | OPTIONAL | No | Used as auth/onboarding fallback. |
| `RATE_LIMIT_*` | OPTIONAL | No | Defaults exist; production overrides should be reviewed. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | CONFIGURATION-PENDING | Yes/path | Required only for seed/maintenance script, not Nest runtime. |
| Email SMTP/API variables | CONFIGURATION-PENDING | Yes | No production email adapter verified. |
| Invitation link base URL | CONFIGURATION-PENDING | No/secret depending implementation | Token-link email flow not verified. |
| Password reset link base URL | CONFIGURATION-PENDING | No/secret depending implementation | Legacy/manual flow only in current audited state. |
| Flutter API base URL | PRODUCTION PRESENCE UNVERIFIED | Public | Must point to production API. |

Phase 7B mandatory new variable: none verified for in-app invitations and report discussion. Email delivery and token-link invitation landing remain configuration-pending/deferred.

## Email and Authentication Readiness

| Capability | Status |
| --- | --- |
| In-app invitations | LOCALLY VERIFIED |
| Organization invitation email | CONFIGURATION-PENDING |
| Invitation token-link landing | PARTIALLY IMPLEMENTED / CONFIGURATION-PENDING |
| Email verification | DEFERRED |
| Password reset email | PARTIALLY IMPLEMENTED legacy/manual flow; production email not verified |
| Welcome email | DEFERRED |
| Provider onboarding email | CONFIGURATION-PENDING |
| Firebase phone authentication | Frontend/Firebase-dependent; production Firebase settings not verified in this phase |
| Email authentication | Not claimed as production-ready |

Current backend invitation metadata truthfully reports `EMAIL_NOT_CONFIGURED` where email delivery is unavailable.

## Dokploy Deployment Readiness Plan

Do not execute until explicitly authorized.

Target revisions:

- Backend: `8ac1fe609ccabe82ddea2ba4235d68ef37af6e5c`
- Flutter: `ce454ff15a60885a71398d72d384a693fa08d9ee`
- Website: unchanged at `0b705e79572d0d9955d760dcb64921419ea353ec`

Backend build behavior:

- `prebuild -> prisma generate`
- `build -> nest build`
- Ignored root `generated` is excluded from production build compilation.

Future deployment sequence:

1. Confirm Dokploy app/service names and rollback revisions.
2. Confirm environment variables without exposing values.
3. Confirm backup and restore-test evidence.
4. Confirm `npx prisma migrate status`.
5. Build backend from authorized branch/commit.
6. Run `npx prisma migrate deploy` only during authorized deployment window.
7. Capture migration logs.
8. Activate backend revision and verify health.
9. Run role-based smoke tests.
10. Build/promote Flutter web.
11. Check Flutter service-worker/cache behavior.
12. Monitor for at least 60 minutes.

## Smoke-Test Account Readiness

Do not create production accounts in this phase. Credentials must not be stored in docs.

| Role | Required readiness | Status |
| --- | --- | --- |
| Citizen | Approved test citizen, OTP/Firebase or password path, reversible report data | EVIDENCE REQUIRED |
| Provider | Approved provider assigned to test org, provider job access | EVIDENCE REQUIRED |
| Dispatch Officer | Approved operator in test org | EVIDENCE REQUIRED |
| Organization Admin | Approved org admin for test organization | EVIDENCE REQUIRED |
| Super Admin | Approved platform admin for controlled checks | EVIDENCE REQUIRED |

Smoke scenarios:

- Login.
- Organization context.
- Invitation create/list/accept/decline/resend/revoke.
- Report discussion.
- Notification deep links/read state.
- Report creation, assignment, provider progress, evidence upload, completion review, closure.
- Trust Center read/update where authorized.
- Upload/evidence visibility boundaries.

Each scenario needs a cleanup owner and reversible test records.

## Monitoring and Rollback Plan

Monitor for 60 minutes after deployment:

- Backend health.
- HTTP 4xx/5xx rates.
- Authentication failures.
- Prisma/database errors.
- Migration errors.
- Report creation and assignment.
- Upload/evidence errors.
- Invitation actions.
- Report-message actions.
- Notification failures.
- CPU, memory, disk.
- Database connection usage.
- Service restarts.
- Flutter loading errors and service-worker/cache issues.

Rollback triggers:

- Backend startup failure.
- Migration failure or drift.
- Abnormal 5xx increase.
- Authentication regression.
- Cross-tenant access defect.
- Invitation privilege escalation.
- Report-discussion exposure.
- Evidence/upload regression.
- Report lifecycle or closure regression.
- Database lock or connection exhaustion.

## Deployment Authorization Checklist

| Gate | Status |
| --- | --- |
| Exact commits confirmed | PASS |
| Clean repositories | PASS except protected local uploads in backend |
| Backend clean install/build/tests pass | PASS |
| Flutter release build passes | PASS |
| Critical vulnerability disposition accepted | NOT VERIFIED |
| No exploitable unresolved critical issue | PASS based on local reachability triage |
| Recent production backup confirmed | NOT VERIFIED |
| Off-site backup confirmed | NOT VERIFIED |
| Restore-test evidence confirmed | NOT VERIFIED |
| Production migration status checked | NOT VERIFIED |
| Disk/storage sufficient | NOT VERIFIED |
| No dangerous DB locks/transactions | NOT VERIFIED |
| Required environment variables confirmed | NOT VERIFIED |
| Rollback revision identified | NOT VERIFIED |
| Deployment window approved | NOT VERIFIED |
| Smoke-test accounts approved | NOT VERIFIED |
| Monitoring available | NOT VERIFIED |
| Rollback owner identified | NOT VERIFIED |
| Deployment owner identified | NOT VERIFIED |
| Explicit production authorization received | NOT VERIFIED |

## Phase 7C-D Result

Recommendation: **READY WITH CONDITIONS**

The release candidate can proceed to a deployment-authorization review only after the missing production evidence is supplied and the critical vulnerability risk acceptance or remediation decision is approved.
