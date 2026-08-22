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

- Backend repository baseline: `f7a395e docs: add tranche 1 operations recovery baseline`
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

TO VERIFY:

- Actual production backup schedule.
- Retention policy.
- Latest backup freshness.
- Isolated restore rehearsal.
- Evidence consistency verification.
- Mount monitoring.
- Alerting.
- Rollback rehearsal.

BLOCKS PILOT:

- No verified backup recovery pair.
- No isolated restore rehearsal.
- Critical evidence persistence uncertainty.

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
