# FixZone Production Operations Runbook

Date: 2026-08-22

Scope: Phase 8 Tranche 1 operating contract for the stabilized FixZone V1 production baseline.

This document defines how FixZone should be operated, verified, rolled back, and prepared for recovery rehearsal. It does not authorize production access, deployment, migration, restore, or data mutation.

## 1. Operating Principles

- Treat the production database and uploaded evidence as one operational system.
- Do not perform deployment, rollback, backup, restore, migration, or data repair without an assigned owner and recorded evidence.
- Do not expose secrets in runbooks, logs, manifests, screenshots, chat transcripts, or ticket comments.
- Do not delete persistent uploads as part of application rollback.
- Do not claim a backup is recoverable until both the database and uploads have passed verification and an isolated restore rehearsal.
- Use read-only checks by default. Any production write check requires explicit approval and a cleanup path.

## 2. Current V1 Baseline

Current stabilized operating assumptions:

- Backend repository baseline: `71ac5ff fix: clean unpersisted evidence uploads on persistence failure`
- Frontend repository baseline: `9378331 fix: keep report citizen rating report-scoped`
- Persistent upload host path: `/srv/securezone-data/fixzone/uploads`
- API container upload path: `/app/uploads`
- Recommended production `UPLOAD_ROOT`: `/app/uploads`
- Evidence database references remain relative paths under upload storage.

The baseline protects:

- Governed responsibility routing.
- Organization responsibility review and acceptance.
- Dispatch and provider assignment lifecycle.
- Provider completion evidence.
- Citizen completion confirmation and rating.
- Organization completion governance.
- CLOSED-state provider-performance semantics.
- Protected evidence routes.
- Evidence-persistence failure-path hardening for current citizen report evidence and provider completion evidence uploads.

Most recent production hardening deployment verification:

```text
71ac5ff fix: clean unpersisted evidence uploads on persistence failure
Dokploy status: Done
Production hardening deployment verification: PASS
```

Recorded post-deployment checks:

- API health: `{"status":"ok","service":"fixzone-enterprise-api","apiPrefix":"/api"}`.
- `UPLOAD_ROOT`: `/app/uploads`.
- Persistent bind mount: host `/srv/securezone-data/fixzone/uploads` to container `/app/uploads`.
- Upload file counts: container `28`, host `28`.
- Upload storage size: container approximately `2.6M`, host approximately `2.6M`.
- No evidence loss observed during container replacement/redeployment.

Hardening limitation:

- File write and database persistence are still not fully atomic.
- The current hardening cleans request-created unpersisted files on handled EvidenceRecord persistence failure.
- A crash/process-kill window remains documented.

## 3. Operational Roles

Roles identify responsibilities, not specific people.

### Release Operator

- Owns deployment and rollback execution.
- Confirms backup and rollback evidence before deployment.
- Captures pre-release and post-release health evidence.
- Stops the release if a hard-stop condition appears.

### Backup Operator

- Owns recovery-set creation and verification.
- Confirms database dump, uploads archive, checksums, and manifest.
- Records backup start/end time, recovery set ID, and verification status.

### Restore Approver

- Approves any restore rehearsal or emergency restore.
- Confirms target environment is isolated unless an emergency production restore is explicitly authorized.
- Confirms restore evidence before rehearsal teardown.

### Incident Lead

- Coordinates incident triage and communication.
- Assigns evidence collection.
- Decides containment path with the Application Owner.
- Confirms do-not-do warnings are followed.

### Application Owner

- Confirms business impact and workflow priority.
- Approves pilot readiness and tranche exit.
- Owns acceptance of residual operational risk.

## 4. RPO / RTO Status

Formal values are not yet committed.

- RPO: TO BE FORMALLY SET.
- RTO: TO BE FORMALLY SET.

Proposed pilot targets, not committed SLA:

- Proposed pilot RPO: restore to the latest verified recovery set.
- Proposed pilot RTO: complete isolated restore rehearsal timing first, then set a measured target.

Formal values require:

- Backup schedule.
- Retention policy.
- Measured restore rehearsal duration.
- Named operational ownership.
- Pilot risk acceptance.

## 5. Daily / Release-Window Checks

Minimum checks before any approved deployment:

- Confirm current backend and frontend commit IDs.
- Confirm no unauthorized migration is pending.
- Confirm latest verified recovery set exists.
- Confirm persistent upload mount path is known.
- Confirm rollback target is identified.
- Confirm smoke-test accounts and owners are approved.
- Confirm no unresolved P0 incident is active.

Minimum checks after any approved deployment:

- API service reports healthy.
- API health endpoint responds.
- Frontend loads.
- Role login smoke checks pass where approved.
- Upload mount remains attached.
- Evidence paths still render through protected routes.
- No elevated 5xx, auth, Prisma, upload, or Flutter asset errors are observed.

## 6. Persistent Upload Mount Verification

Expected production dependency:

- Host: `/srv/securezone-data/fixzone/uploads`
- Container: `/app/uploads`
- `UPLOAD_ROOT`: `/app/uploads`

Required post-deployment checks:

- API service is running at expected replica count.
- API health is OK.
- Container environment reports the expected `UPLOAD_ROOT`.
- Container mount destination points to `/app/uploads`.
- Host source path points to `/srv/securezone-data/fixzone/uploads`.
- Container and host file counts are plausibly aligned.
- Container and host storage usage are recorded.
- Representative protected evidence URLs render for authorized users.

Writable directory check design:

- Prefer a controlled write-canary under a dedicated operational health subdirectory outside report evidence paths.
- The canary file must have a unique timestamped name, a documented owner, and immediate cleanup.
- Do not leave junk files in `report-evidence/` or `report-completion/`.
- Do not use citizen/provider evidence directories for infrastructure probes.
- If write-canary approval is not available, use read-only mount and file-count checks plus the next approved upload workflow.

Application operational-health check:

- Public liveness remains `GET /api/health` and exposes only a safe process summary.
- Protected operational status is available to Super Admin users through `GET /api/platform-tools/operational-health`.
- The protected check verifies database connectivity with a read-only query.
- The protected check verifies the configured upload root exists, is readable, and passes a single temporary write/read/delete canary.
- The canary file name starts with `.fixzone-operational-health-canary-`.
- The canary is created directly under `UPLOAD_ROOT`, not under `report-evidence/` or `report-completion/`.
- The canary uses exclusive creation and is deleted immediately.
- The application does not claim to prove the Docker host bind source path from inside the container.
- Host-level monitoring must separately verify that `/srv/securezone-data/fixzone/uploads` is mounted to `/app/uploads`.
- The operational-health response avoids database hostnames, credentials, container IDs, host backup locations, detailed exception stacks, and private file contents.

External host monitoring check:

- A read-only host-monitoring helper is now drafted at `scripts/operations/fixzone_operational_check.sh`.
- It complements the application endpoint by checking Docker service discovery, host bind mount identity, host/container upload count and size consistency, canary residue, host disk free space, recovery-set artifact presence, optional checksum verification, and backup freshness thresholds.
- It does not restart services, delete files, create backups, restore backups, run migrations, modify uploads, modify the database, or perform auto-remediation.
- It must be reviewed and operator-approved before scheduled production execution.
- It must compare current host/container values, not the historical `28` file baseline as a permanent expected count.
- Backup freshness remains `UNKNOWN` when no approved freshness threshold is configured.
- Local host-state support is implemented for review through `FIXZONE_MONITOR_STATE_DIR`, with a host default of `/srv/securezone-ops/fixzone/state`.
- The monitor writes only `latest-status.json`, `heartbeat.json`, and its own atomic-write temp files in the configured state directory.
- `latest-status.json` records the latest completed cycle; `heartbeat.json` records `lastStartedAt` at start and completion metadata only after the run completes.
- State write failure is reported locally. It changes an otherwise `HEALTHY` run to `WARNING`, but it does not mask an existing `WARNING`, `CRITICAL`, or `UNKNOWN` operational classification.
- This state support does not create a systemd timer, activate backup freshness thresholds, configure alert delivery, create backups, restore backups, or delete backups.
- Production verification of c3e37fb host-local state/heartbeat support is recorded as PASS: valid state JSON, completed heartbeat, lastExitCode `3`, lastOverallState `UNKNOWN`, secret-field safety PASS, no temp-file residue, canary residue `0/0`, upload count `28/28`, and post-run API health PASS.
- Repository-managed systemd service/timer package is prepared locally under `ops/systemd/` for review only. It has not been installed, enabled, started, pushed, deployed, or used to activate backup thresholds.
- The service package uses `/srv/securezone-ops/fixzone/current/fixzone_operational_check.sh`, `FIXZONE_MONITOR_STATE_DIR=/srv/securezone-ops/fixzone/state`, optional non-secret `/etc/fixzone/host-monitor.env`, and `SuccessExitStatus=1 2 3` to distinguish monitor classifications from true service execution failures.
- The timer package uses `OnBootSec=5min`, `OnUnitActiveSec=15min`, `AccuracySec=1min`, and `Persistent=true` for the approved 15-minute cadence, but timer enablement remains a separate gate.
- VPS systemd validation attempt is classified as BLOCKED SAFELY BEFORE INSTALLATION due to invalid repository-relative `Documentation=docs/...` unit metadata and missing `/srv/securezone-ops/fixzone/current` at verification time. This is an installation procedure / unit metadata defect, not a monitor runtime failure, application failure, production data failure, or backup failure.

Application monitoring production verification:

- Authenticated Super Admin UI request to `GET /api/platform-tools/operational-health` returned HTTP `200`.
- Observed state: overall `UNKNOWN`, database `HEALTHY` at `2 ms`, upload storage `HEALTHY`, canary `Removed`, upload files `28`, upload size `2.4 MB`, capacity `HEALTHY`, free space `48%`, backup visibility `UNKNOWN`.
- Overall `UNKNOWN` is expected until external backup freshness and verification metadata are operator-managed.

Approved pilot policy baseline:

- The Balanced / Option B policy is approved as the Phase 8 Tranche 1 pilot operating baseline in `docs/stabilization/phase8/FixZone_Pilot_Operational_Monitoring_Backup_and_Alert_Policy.md`.
- Approved values: daily coordinated PostgreSQL plus uploads recovery set, 30-hour freshness warning, 48-hour freshness critical, 15-minute host monitor cadence, checksum verification after every backup, monthly restore rehearsal, systemd timer scheduler, and retention target of 7 daily / 4 weekly / 3 monthly recovery points.
- This approval does not create the systemd timer, activate runtime thresholds, delete backups, create backups, restore data, or configure alert delivery.

Alert-state model:

- `HEALTHY`: check passed.
- `WARNING`: check passed with a threshold concern.
- `CRITICAL`: dependency is unavailable or unsafe for normal operation.
- `UNKNOWN`: the check cannot be performed safely from application runtime.

No automatic remediation is performed by the operational-health endpoint.

## 7. Deployment Rollback Checklist

Rollback must preserve uploaded evidence.

### Backend Deployment Rollback

- Capture pre-rollback evidence: current health, current commit/image, error symptoms, logs.
- Select approved previous backend commit/image.
- Confirm database compatibility, especially when no migration exists.
- Use the approved Dokploy rollback or redeploy path.
- Verify API health after rollback.
- Verify upload mount after rollback.
- Run approved backend smoke checks.
- Monitor for 5xx, auth, Prisma, and upload errors.

### Frontend Deployment Rollback

- Capture current frontend commit/assets and user-facing symptoms.
- Select approved previous frontend commit/build.
- Use approved Dokploy/static-web rollback or redeploy path.
- Clear or refresh caches only through approved procedure.
- Verify gateway and role shells load.
- Verify key screens that were affected by the release.

### Application-Code Rollback With No Migration

- Prefer rolling application code back to the last known good image/build.
- Leave database and uploads unchanged.
- Verify compatibility using smoke checks.
- Record whether any user actions occurred during the failed release window.

### Release With DB Migration

- Migration rollback requires separate governance.
- Prefer forward-compatible rollback where additive schema changes remain in place.
- Do not drop tables, columns, enum values, or data without explicit recovery approval.
- Restore database only if there is real data corruption, destructive migration failure, or approved disaster recovery need.

### Persistent Uploads

- Never delete or replace `/srv/securezone-data/fixzone/uploads` because an application version rolls back.
- Do not clean evidence files during rollback.
- If evidence paths appear broken, treat as an incident and verify mount, database references, and file existence.

## 8. Tranche 1 Readiness Checklist

DONE:

- Stabilized V1 baseline.
- Persistent upload architecture documented.
- Backup/recovery baseline assessment documented.
- Operations runbook created.
- Backup and recovery contract created.
- Isolated restore rehearsal procedure created.
- Incident response runbook created.
- Verified coordinated post-V1 recovery set.
- Checksum verification completed.
- PostgreSQL isolated restore rehearsal completed.
- Uploads isolated restore rehearsal completed.
- Exact database count reproduction verified.
- Production/restored evidence-tree equality verified.
- Canonical Gwagwalada UAT recovery proof documented.
- Evidence-persistence failure-path hardening implemented in `71ac5ff`.
- Evidence-persistence hardening deployed through Dokploy with status `Done`.
- Post-deployment API health, upload mount, file-count, and storage-size checks recorded as PASS.
- No evidence loss observed during the hardening redeployment.
- Protected operational-health endpoint added for database, upload-root, disk-capacity, backup-visibility, and alert-state reporting.

TO VERIFY:

- Actual production backup schedule.
- Retention policy.
- Latest backup freshness.
- Historical EvidenceRecord/file mismatch per-item export and classification.
- Mount monitoring.
- Alerting.
- Recurring restore cadence.
- Rollback rehearsal.
- Operator-approved scheduling and first production evidence for the external host-monitoring script.
- Production deployment/versioning of host-local state/heartbeat support. c3e37fb state/heartbeat execution is verified; recurring timer activation remains separate.
- First supervised systemd timer run after separate approval.

Future manual host-monitor service installation gate:

1. Verify exact Git commit and checksums for `ops/systemd/fixzone-host-monitor.service`, `ops/systemd/fixzone-host-monitor.timer`, and the monitor script.
2. Verify the approved version directory exists under `/srv/securezone-ops/fixzone/<commit>/`.
3. Create or verify `/srv/securezone-ops/fixzone/state`.
4. Create or verify the `/srv/securezone-ops/fixzone/current` symlink.
5. Download or copy candidate unit files into a review location.
6. Run `systemd-analyze verify` against the candidate unit files while the current symlink exists.
7. Install unit files under `/etc/systemd/system/`.
8. Run `systemd-analyze verify` against the installed units.
9. Run `systemctl daemon-reload`.
10. Confirm the timer is disabled and inactive.
11. Stop for separate manual first-service-run approval.
12. Manually run `fixzone-host-monitor.service` once only after that approval.
13. Inspect service status, journald output, `latest-status.json`, and `heartbeat.json`.
14. Verify API health, upload count parity, and canary residue `0/0`.
15. Enable the timer only after explicit approval.
16. Observe and record the first timer-triggered execution.

Rollback gate:

- Disable/stop the timer if required, preserve state evidence, atomically switch `current` back to a previous version, manually test the previous monitor, and never alter production uploads or backups as part of monitor rollback.

BLOCKS PILOT:

- Historical EvidenceRecord/file mismatch remains unresolved and unrepaired.
- Backup schedule, retention, alerting, mount monitoring, recurring restore cadence, and rollback rehearsal remain open.

## 9. Stop Conditions

Stop and escalate before continuing if:

- The protected upload mount is missing.
- API health fails after deployment.
- Database connectivity fails.
- Evidence images disappear or counts drop unexpectedly.
- Backup verification fails.
- Recovery-set manifest is incomplete.
- A migration is required but not authorized.
- A secret appears in a log, document, or manifest.
- Rollback target is unknown.
