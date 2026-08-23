# FixZone Phase 8 Tranche 1 - Production Operations and Recovery Baseline

Date: 2026-08-22

Scope: read-only baseline investigation for operational reliability, backup, restore, rollback, health monitoring, incident readiness, and adoption support.

Backend repository head observed: `71ac5ff fix: clean unpersisted evidence uploads on persistence failure`

Frontend repository head observed: `9378331 fix: keep report citizen rating report-scoped`

Verdict: production operations are suitable for controlled V1 stabilization only with conditions. Core recovery controls now include a documented isolated recovery rehearsal and a deployed evidence-persistence failure-path hardening fix, but Tranche 1 is not fully complete until backup scheduling, retention, alerting, mount monitoring, rollback rehearsal, recurring restore cadence, and historical mismatch classification are closed.

## 1. Executive Summary

The Phase 8 Tranche 1 baseline confirms that FixZone has important building blocks for operational recovery:

- PostgreSQL is the authoritative database.
- Citizen and provider evidence files are stored on the API filesystem through a persistent upload root.
- Platform Tools expose guarded health and metadata-backup workflows.
- Prior stabilization documentation identifies backup, restore, persistent upload storage, rollback, and incident-readiness gaps.
- A local protected controlled-release script contains concrete manual backup behavior for PostgreSQL and uploads.
- The coordinated recovery set `fixzone-v1-baseline-2026-08-22_15-53-38` passed isolated restore rehearsal.
- Backend commit `71ac5ff fix: clean unpersisted evidence uploads on persistence failure` was deployed successfully and production-verified as PASS.

The main operational gap has shifted from initial proof to ongoing operations. Recovery rehearsal evidence and hardening deployment verification now exist, while schedule, retention, alerting, mount monitoring, rollback rehearsal, recurring restore cadence, and historical mismatch classification remain open.

Primary remaining Tranche 1 objective: operationalize the verified backup/restore path with monitoring, alerting, retention, rollback rehearsal, and periodic evidence-consistency review before broad operational adoption.

Current monitoring foundation update:

- Public liveness remains limited to safe API process status at `GET /api/health`.
- Protected operational health is exposed to Super Admin users through `GET /api/platform-tools/operational-health`.
- Application-visible checks include database reachability, upload-root existence/readability/writability, temporary canary cleanup, upload directory counts/size, disk capacity where supported, metadata backup visibility, and generated alert state.
- The application does not claim to prove Docker host bind mount identity; that remains an external host-level monitoring requirement.
- No cron job, production backup command, restore command, service restart, evidence repair, or destructive auto-remediation was introduced.

Application monitoring production verification update:

- Authenticated Super Admin UI verified `GET /api/platform-tools/operational-health` with HTTP `200` and preflight `204`.
- Observed production states: overall `UNKNOWN`, database `HEALTHY`, database latency `2 ms`, upload storage `HEALTHY`, canary `Removed`, upload files `28`, upload size `2.4 MB`, capacity `HEALTHY`, free space `48%`, backup visibility `UNKNOWN`.
- Canary residue after checks remained `0` in the container and `0` on the host.
- Application runtime `UNKNOWN` remains expected for external backup verification because durable checksum status is not yet consumed by the routine monitor. Host-monitor backup freshness thresholds are production-verified active at `30`/`48` hours, while formal RPO/RTO values remain not approved.

External host-monitoring design update:

- A read-only script has been drafted at `scripts/operations/fixzone_operational_check.sh`.
- It checks public API health, Docker service discovery, bind mount identity, current host/container upload count and size consistency, canary residue, disk thresholds, recovery-set artifact presence, optional checksum verification, and configurable backup freshness.
- It is not scheduled or production-run by this document.
- It does not perform auto-remediation, backup, restore, deletion, restart, migration, production repair, or production data mutation.

Approved pilot policy update:

- The Balanced / Option B pilot policy is now approved as the Phase 8 Tranche 1 operating policy baseline.
- Approved operating values: daily coordinated PostgreSQL plus uploads recovery set, 30-hour freshness warning, 48-hour freshness critical, 15-minute host monitor cadence, checksum verification after every backup, monthly restore rehearsal plus change-triggered rehearsals, systemd timer scheduler, and retention target of 7 daily / 4 weekly / 3 monthly recovery points.
- Formal RPO and formal RTO remain not approved.
- No new systemd unit, timer, backup automation, alert delivery, retention deletion, restore, production repair, or production mutation is authorized by this policy documentation update. Threshold activation is separately production-verified PASS.

Host-local state implementation update:

- `scripts/operations/fixzone_operational_check.sh` now has local review-only support for `latest-status.json` and `heartbeat.json`.
- State output is configured with `FIXZONE_MONITOR_STATE_DIR`; the host default is `/srv/securezone-ops/fixzone/state`, while tests use temporary fixture directories.
- The monitor updates `heartbeat.json` at start and writes completed-cycle state only after checks finish.
- State files are written with same-directory temporary files and atomic replacement.
- The monitor does not delete unrelated files in the state directory and does not schedule itself, send alerts, create backups, restore backups, delete backups, or mutate production. Threshold activation is managed by non-secret host-local configuration and is now verified PASS.

Production state/heartbeat verification update:

- c3e37fb state/heartbeat monitor execution is production-verified as PASS from `/srv/securezone-ops/fixzone/c3e37fb/fixzone_operational_check.sh`.
- Observed heartbeat recorded monitorVersion `c3e37fb`, lastStartedAt, lastCompletedAt, lastExitCode `3`, lastOverallState `UNKNOWN`, and lastUnknownAt.
- State JSON validated; secret-field safety passed; no temp-file residue was observed.
- Canary residue remained `0` in the container and `0` on the host.
- Production upload integrity remained `28` container files and `28` host files, approximately `2.6M` on both sides.
- Post-run API health passed.
- Backup freshness threshold activation is production-verified PASS with the approved `30` hour warning and `48` hour critical values active.
- Checksum verification visibility remains `UNKNOWN` until durable verification metadata is read by the monitor from completed recovery sets.

Systemd host-monitor package update:

- Review-only repository-managed unit files are prepared under `ops/systemd/`.
- `fixzone-host-monitor.service` invokes `/srv/securezone-ops/fixzone/current/fixzone_operational_check.sh`, records state under `/srv/securezone-ops/fixzone/state`, and uses `SuccessExitStatus=1 2 3`.
- `fixzone-host-monitor.timer` defines the approved 15-minute cadence with `OnBootSec=5min`, `OnUnitActiveSec=15min`, `AccuracySec=1min`, and `Persistent=true`.
- That repository package was not installed, enabled, started, pushed, deployed, or used to activate thresholds during local review.
- Runtime 30h/48h backup freshness thresholds are now production-verified active through non-secret host-local configuration.
- First VPS systemd validation was blocked safely before installation. Findings were invalid repository-relative `Documentation=docs/...` unit metadata and missing `/srv/securezone-ops/fixzone/current` during `systemd-analyze verify`.
- This is classified as an installation procedure / unit metadata defect, not monitor runtime failure, application failure, production data failure, or backup failure.
- Corrected package removes invalid `Documentation=` directives and corrected documentation requires state/current setup before systemd verification. No timer was enabled and no threshold was activated.

Systemd production verification update:

- Host monitor systemd installation is production-verified as PASS.
- Installed monitor: `/srv/securezone-ops/fixzone/c3e37fb/fixzone_operational_check.sh`.
- Current symlink: `/srv/securezone-ops/fixzone/current -> /srv/securezone-ops/fixzone/c3e37fb`.
- Installed units: `/etc/systemd/system/fixzone-host-monitor.service` and `/etc/systemd/system/fixzone-host-monitor.timer`.
- Timer is enabled and active with the approved 15-minute design.
- Manual service run and first timer-triggered execution passed; systemd recorded a successful completed oneshot.
- Monitor classification remains `UNKNOWN` by design with lastExitCode `3`, lastOverallState `UNKNOWN`, monitorVersion `c3e37fb`, and heartbeat completion `2026-08-23T10:11:52Z`.
- Canary residue remained `0/0`, uploads remained `28/28`, and API remained healthy.
- No production evidence loss or mutation was observed.

Backup freshness threshold activation package update:

- Repository template `ops/systemd/host-monitor.env.example` prepares future activation of the approved 30h/48h policy through `/etc/fixzone/host-monitor.env`.
- Template values are `FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS=30` and `FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS=48`.
- Threshold activation is production-verified PASS; the local repository template remains non-secret documentation of the active variable names and values.
- Checksum verification visibility remains `UNKNOWN`; backup jobs should verify checksums after successful backup creation and publish durable verification status for the monitor to read in a future package.

Daily coordinated recovery backup local implementation update:

- Review-only script added at `scripts/operations/fixzone_recovery_backup.sh`.
- It creates a new `fixzone-v1-backup-YYYY-MM-DD_HH-MM-SS` UTC recovery set using an in-progress directory and publishes only after validation and checksum verification pass.
- Required artifacts are `fixzone-postgres.dump`, `fixzone-uploads.tar.gz`, `database-toc.txt`, `uploads-list.txt`, `recovery-manifest.txt`, `checksums.sha256`, and `verification-status.json`.
- It supports explicit `host` and `docker-swarm` PostgreSQL execution modes. Docker Swarm mode requires a configured stable service name and refuses zero, ambiguous, or mismatched running service tasks.
- It avoids transient container IDs, avoids printing secret values, uses PostgreSQL tooling supplied by the selected execution mode, and keeps DB credential handling outside artifacts and logs.
- It excludes operational-health canary residue from the uploads archive/listing, records residue state, preserves existing recovery sets, and refuses unsafe paths or overwrites.
- No production backup, systemd backup timer, restore, retention deletion, deployment, push, frontend change, Prisma change, or protected release-script change is authorized by this local implementation.

PostgreSQL container portability preflight update:

- Read-only production discovery is PASS; the first production backup remains NOT EXECUTED.
- Sanitized FixZone database mapping is host/service `securezoneinfrastructure-postgres-bhwgzt`, port `5432`, database `postgres`, with credentials redacted.
- The stable identity is the Docker Swarm service `securezoneinfrastructure-postgres-bhwgzt`; observed container ID and task name are transient and must not be hard-coded.
- The host does not provide `pg_dump` or `pg_restore`, while the FixZone PostgreSQL task provides `/usr/bin/pg_dump` and `/usr/bin/pg_restore`.
- The FixZone PostgreSQL service uses `postgres:17`; multiple unrelated PostgreSQL services exist, so generic PostgreSQL container discovery is unsafe.
- Repository portability hardening is required before first supervised backup execution.

First supervised backup attempt update:

- Result: FAILED SAFELY.
- Capacity preflight passed; exact Swarm service selection passed; PostgreSQL major `17` check passed.
- The backup stopped at `pg_dump` with role-selection/authentication failure because no explicit PostgreSQL database role was supplied and PostgreSQL defaulted to the container execution user.
- Classification: database role-selection / configuration defect only; not database corruption, PostgreSQL outage, restore failure, upload failure, backup corruption, or application failure.
- No successful new-style recovery set exists from this attempt.
- Protected verified baseline remained present.
- Production state after failure remained uploads `28/28`, canaries `0/0`, API healthy, and host monitor timer enabled/active.
- Backup retry was not performed; failed evidence cleanup was not performed.
- Future production retry requires a safely verified `FIXZONE_POSTGRES_USER` value in `/etc/fixzone/recovery-backup.env`; the role value is not invented by this repository update.

## 2. Current Backup Inventory

Mechanisms found:

- Platform Tools metadata snapshot backup under `src/platform-tools/platform-tools.service.ts`.
- Platform Tools backup list, download, delete, and guarded restore controller endpoints.
- Persistent upload storage documentation under `docs/deployment/Persistent_Upload_Storage_Dokploy.md`.
- Phase 7 backup, restore, deployment, rollback, and DR assessment documentation.
- Local protected controlled-release script at `scripts/fixzone_controlled_production_release.sh`.

Important distinction:

- Platform Tools backup is not an operational full-system backup. It is a governance-controlled metadata snapshot.
- The protected controlled-release script contains operational backup behavior for PostgreSQL and uploads, but it is untracked and must remain protected.

## 3. Database Recovery Status

Classification: rehearsed once for the recorded Phase 8 recovery set; recurring operational cadence remains open.

Evidence found:

- Prisma datasource uses PostgreSQL.
- Application startup and Platform Tools include database connectivity checks.
- The protected controlled-release script performs a PostgreSQL custom-format dump with `pg_dump`.
- The script verifies dump readability with `pg_restore --list`.
- The recovery evidence document records an isolated PostgreSQL restore rehearsal with exact database count reproduction.

Operational risk:

- A backup file that passes `pg_restore --list` is necessary but not sufficient. The recorded recovery set has been rehearsed once, but future backups are not proven recoverable until each approved restore drill completes in isolation and records evidence.

## 4. Evidence Recovery Status

Classification: rehearsed once for the recorded Phase 8 recovery set, with historical consistency findings remaining.

Evidence found:

- Persistent upload storage documentation identifies `/app/uploads` as the in-container upload root when `UPLOAD_ROOT=/app/uploads`.
- Expected host mount is `/srv/securezone-data/fixzone/uploads`.
- Evidence references are stored as relative paths such as `report-evidence/<reportId>/<fileName>` and `report-completion/<reportId>/<fileName>`.
- Protected evidence routes include report evidence and completion evidence endpoints.
- The protected controlled-release script archives uploads as a tarball and verifies readability with `tar -tzf`.
- The recovery evidence document records isolated upload restore, production/restored evidence-tree equality, and canonical Gwagwalada UAT recovery proof.
- Post-hardening deployment verification recorded container and host upload file counts of `28` and `28`, with both storage sizes approximately `2.6M`.

Operational risk:

- Upload archive listing alone proves only readability. The recorded recovery rehearsal adds stronger proof for that recovery set, but future backup sets still require database-to-file reconciliation.
- Database and uploads are captured sequentially, so new evidence created during backup can create a consistency gap unless operations are paused or otherwise bounded.

## 5. Backup Consistency Model

Current model: sequential manual backup.

Observed behavior:

- Database dump is captured.
- Upload directory archive is captured.
- Checksums and listing files are generated by the protected release script.

Consistency limitation:

- The database dump and uploads archive do not represent a guaranteed atomic point-in-time snapshot.
- Evidence uploaded between the database dump and upload archive can create mismatch risk.
- Partially completed uploads or path references can create restore ambiguity.

Minimum V1 mitigation:

- Use a maintenance window or short write freeze for controlled backups.
- Capture database dump and uploads archive in the same approved backup window.
- Record start and end timestamps.
- Preserve file counts, archive size, checksums, and restore verification evidence.
- Add database-to-file consistency checks during rehearsal.

## 6. Retention Status

Classification: improved but not complete.

Findings:

- Older stabilization documents discuss retention as an operational requirement.
- Platform Tools metadata backups do not establish a complete operational retention policy.
- The protected release script writes timestamped backup directories, but no repository evidence confirms pruning, off-site retention, retention duration, or storage-capacity safeguards.

Required policy:

- Define daily, weekly, and monthly retention windows.
- Define owner approval for deletion.
- Define off-site or independent copy expectations.
- Define minimum free disk threshold and escalation.

## 7. Verification Status

Classification: partial.

Verification mechanisms found:

- `pg_restore --list` for PostgreSQL dump readability.
- `tar -tzf` for upload archive readability.
- `SHA256SUMS` generation in the protected release script.
- Platform Tools metadata backup creation and guarded restore policy.

Verification gaps:

- One current isolated full restore proof exists for recovery set `fixzone-v1-baseline-2026-08-22_15-53-38`.
- Database-to-upload evidence consistency found a historical mismatch and must become a recurring report.
- No current sampled protected evidence URL verification after restore.
- No current backup failure alert verification.
- No current scheduled backup success evidence.

Production hardening deployment verification recorded:

- Backend commit: `71ac5ff fix: clean unpersisted evidence uploads on persistence failure`.
- Deployment path: `f3468bf..71ac5ff main -> main`.
- Dokploy result: `Done`.
- API health: PASS.
- `UPLOAD_ROOT`: PASS at `/app/uploads`.
- Persistent bind mount: PASS from `/srv/securezone-data/fixzone/uploads` to `/app/uploads`.
- Container/host upload file counts: PASS at `28/28`.
- Container/host upload storage size: PASS at approximately `2.6M/2.6M`.
- Evidence loss during redeployment: none observed.

## 8. Restore Rehearsal Design

Safe rehearsal should be isolated and non-production.

Recommended design:

1. Obtain an approved backup set containing PostgreSQL dump, upload archive, checksums, and manifest files.
2. Verify checksums before restore.
3. Restore PostgreSQL dump into an isolated database or temporary container.
4. Extract uploads into an isolated upload directory.
5. Point a non-production API instance to the isolated `DATABASE_URL` and isolated `UPLOAD_ROOT`.
6. Run schema validation and application startup checks.
7. Verify representative reports, evidence records, completion evidence, and protected evidence routes.
8. Produce a restore evidence note with counts, timestamps, checked report IDs, and pass/fail results.
9. Dispose of isolated resources only after evidence is captured and approved.

No production restore should be performed as part of Tranche 1 baseline creation.

## 9. Health / Observability Inventory

Found:

- API health endpoint exists.
- Platform Tools health reports database, upload directory, backup directory, and operational counters.
- Prisma startup database connectivity check exists unless explicitly disabled.

Partial:

- Upload directory health reports are directory-level checks, not full mount identity, write-canary, or evidence consistency checks.
- Application and container monitoring are described conceptually but not proven as live alerting configuration in the repository.

Missing or unproven:

- External uptime monitoring evidence.
- Alert routing evidence.
- Backup job success/failure notification evidence.
- Disk utilization alerting evidence.
- Upload mount failure alerting evidence.

## 10. Rollback Readiness

Classification: documented but unrehearsed.

Findings:

- Phase 7 deployment and rollback documentation exists.
- Protected release script writes a rollback plan and records deployment state.
- Rollback guidance prefers application rollback first and database restore only for actual data or schema corruption.

Gaps:

- No current rollback rehearsal evidence.
- No documented rollback owner matrix for Phase 8 operations.
- No standard post-rollback smoke checklist committed as a current runbook.

## 11. Runbook / Incident Readiness

Classification: partial.

Runbook topics found across documents:

- Deployment and rollback caution.
- Persistent upload storage setup.
- Backup and restore gap analysis.
- Operational reliability planning.

Missing consolidated runbook topics:

- API outage response.
- Database outage response.
- Upload mount missing or read-only response.
- Evidence missing response.
- Disk full response.
- Failed backup response.
- Failed deployment response.
- Notification outage response.
- Escalation owners and decision authority.

## 12. Security / Secrets Operational Assessment

Findings:

- No secret values were required or accessed for this baseline.
- The protected release script references operational environment variables and container discovery; it should remain protected and untracked unless an approved release-control process says otherwise.
- Platform Tools restore is intentionally disabled unless explicitly allowed by `ALLOW_PLATFORM_METADATA_RESTORE`.
- Metadata restore is distinct from production operational restore.

Risks to manage:

- Avoid logging secret values during backup or restore operations.
- Avoid exposing restore controls without audit, authorization, confirmation, and rollback safeguards.
- Treat seed/demo credentials as non-production only and keep them out of operational procedures.
- Maintain non-secret environment templates so operators know required variables without exposing values.

## 13. P0 / P1 / P2 / P3 Gaps

P0:

- Current production operations runbook.
- Verified backup set covering PostgreSQL and uploads.
- Isolated restore rehearsal covering PostgreSQL and uploads.
- Database-to-upload evidence consistency verification.
- Persistent upload mount health and backup verification.
- API, database, upload, and disk failure response procedures.
- Rollback owner matrix and smoke checklist.

P1:

- Backup schedule documentation.
- Backup retention policy.
- Backup failure alerts.
- Checksum and manifest retention.
- Non-secret operational environment inventory.
- Incident communication templates.
- Routine log review checklist.

P2:

- Backup size and growth trend monitoring.
- Storage capacity dashboard.
- Periodic restore rehearsal cadence.
- Dependency and security review schedule.
- Operator handover checklist.

P3:

- PostgreSQL point-in-time recovery or WAL archiving.
- Independent off-site replication.
- Automated disaster recovery orchestration.
- Object-storage based evidence durability improvements.

## 14. Recommended Implementation Order

1. Approve and publish a Phase 8 production operations runbook.
2. Define backup ownership, schedule, retention, and escalation.
3. Capture one approved backup set containing database and uploads.
4. Perform an isolated restore rehearsal.
5. Add evidence consistency verification between restored database references and restored files.
6. Document rollback owners, rollback steps, and smoke tests.
7. Add backup, disk, database, API, and upload mount alerting.
8. Schedule recurring restore drills and record evidence.

## 15. Tranche 1 Exit Criteria

Tranche 1 should not be considered complete until all of the following are true:

- A current operations runbook exists and is approved.
- Backup scope explicitly includes PostgreSQL and uploads.
- Backup retention and storage locations are documented.
- Backup verification includes checksums, dump listing, archive listing, and file count evidence.
- A restore rehearsal has been completed in an isolated environment.
- Restored database references have been checked against restored evidence files.
- Evidence-persistence failure-path hardening is deployed and its residual crash/process-kill limitation is accepted.
- API, database, upload storage, disk, and backup health checks have owner response paths.
- Rollback procedure has owner approval and post-rollback smoke checks.
- No production restore, migration, deployment, or data mutation is performed without explicit release authorization.

## 16. Recovery Rehearsal Evidence Update

Evidence document:

```text
docs/stabilization/phase8/FixZone_V1_Recovery_Rehearsal_Evidence.md
```

Recovery Set ID:

```text
fixzone-v1-baseline-2026-08-22_15-53-38
```

Items now verified:

- Coordinated post-V1 recovery set.
- Checksum verification for PostgreSQL dump and uploads archive.
- PostgreSQL isolated restore rehearsal.
- Uploads isolated restore rehearsal.
- Exact database count reproduction for Reports, EvidenceRecord, and ReportActivity.
- Production/restored evidence-tree equality.
- Canonical Gwagwalada Jurisdiction Routing UAT 2 recovery proof.

Recovery rehearsal classification:

```text
PASS
```

Data-integrity classification:

```text
PASS WITH HISTORICAL FINDING / INVESTIGATION REQUIRED
```

Important limitation:

- Database-to-file reconciliation found a pre-existing historical mismatch between some EvidenceRecord rows and physical evidence files.
- The production physical evidence tree and restored physical evidence tree were identical, so the mismatch is not classified as backup corruption.
- No production repair was performed.

Open Phase 8 items:

- Historical EvidenceRecord/file mismatch per-item export and classification.
- Backup automation implementation and scheduling.
- Retention dry-run and later governed enforcement.
- Alert delivery architecture beyond structured logs and host-local status.
- Production deployment/versioning of monitor state and heartbeat support.
- Recurring restore cadence.
- Rollback rehearsal.
- Host-level mount monitoring for actual bind source/destination identity.
- External operational-backup freshness monitoring for the verified recovery-set path.
- Operator approval, scheduling, and first production evidence capture for the external host-monitoring script.

## 17. Evidence-Persistence Hardening Production Verification

Implementation commit:

```text
71ac5ff fix: clean unpersisted evidence uploads on persistence failure
```

Deployment record:

```text
f3468bf..71ac5ff main -> main
Dokploy status: Done
```

Post-deployment verification:

- Active API container observed: `ebc89a5f8ae1`.
- API health: PASS.
- `UPLOAD_ROOT`: `/app/uploads`, PASS.
- Persistent bind mount: host `/srv/securezone-data/fixzone/uploads`, container `/app/uploads`, type `bind`, PASS.
- Upload file counts: container `28`, host `28`, PASS.
- Upload storage size: container approximately `2.6M`, host approximately `2.6M`, PASS.
- Evidence loss during redeployment: none observed.

Hardening behavior now completed for current V1 failure path:

- Request-created evidence files are tracked until EvidenceRecord persistence succeeds.
- On handled EvidenceRecord persistence failure, only newly created unpersisted files are targeted for compensating cleanup.
- Cleanup is path-checked under `UPLOAD_ROOT` and uses single-file deletion only.
- Original database/business exceptions are preserved.
- Cleanup failure is logged without replacing the original failure.
- Already persisted files in multi-image workflows remain preserved.
- Pre-existing evidence and historical files are not targeted.

Residual limitation:

- Filesystem writes and database writes are not fully atomic.
- A crash or process kill after file write and before cleanup remains a documented residual risk.
- Historical mismatch remains unresolved and unrepaired.

Canonical UAT status:

- Gwagwalada Jurisdiction Routing UAT 2 remains CLOSED and recoverable.
- Citizen evidence recovery remains PASS.
- Provider completion evidence recovery remains PASS.
- It is not part of the historical mismatch set.
