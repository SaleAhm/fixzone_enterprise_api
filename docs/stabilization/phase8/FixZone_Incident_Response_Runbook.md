# FixZone Incident Response Runbook

Date: 2026-08-22

Scope: Phase 8 Tranche 1 incident procedures for operating the stabilized FixZone V1 baseline.

This document does not authorize production mutation, restore, migration, deployment, or destructive cleanup. It defines containment and evidence collection paths.

## 1. Incident Roles

- Incident Lead: coordinates response and communications.
- Release Operator: handles deployment or rollback actions if approved.
- Backup Operator: verifies latest recovery set and backup status.
- Restore Approver: approves restore rehearsal or emergency restore path.
- Application Owner: accepts business impact decisions and pilot readiness risk.

## 2. General Incident Rules

- Prefer read-only evidence collection first.
- Do not delete uploads.
- Do not run migrations during incident triage unless explicitly approved.
- Do not restore production without emergency restore authorization.
- Do not expose secrets in incident notes.
- Preserve logs, timestamps, affected user roles, report IDs, and screenshots where safe.
- Escalate immediately if evidence integrity, cross-tenant authorization, or data loss is suspected.

## 3. API Unavailable

Detection:

- API health fails.
- Frontend calls return network errors or 5xx.
- Dokploy/service dashboard shows API unavailable.

Immediate containment:

- Stop new deployment activity.
- Confirm whether a release just occurred.
- Keep database and uploads untouched.

Evidence to collect:

- API health response.
- Service status.
- Recent API logs.
- Current backend commit/image.
- Recent deployment events.

Escalation:

- Incident Lead and Release Operator.
- Application Owner if user workflow is blocked.

Recovery path:

- Restart/redeploy only through approved operations path.
- Roll back backend if linked to a bad release.
- Verify API health, database connectivity, upload mount, and role smoke checks.

Do-not-do warnings:

- Do not restore database for a simple API outage.
- Do not delete uploads.
- Do not change environment variables without approval.

## 4. Frontend Unavailable

Detection:

- Web app does not load.
- Static assets fail.
- Users see blank screen or routing failure.

Immediate containment:

- Stop frontend deployment activity.
- Confirm API health separately.

Evidence to collect:

- Browser console/network evidence.
- Current frontend commit/build.
- Recent deployment events.
- Affected routes and roles.

Escalation:

- Incident Lead and Release Operator.

Recovery path:

- Roll back frontend build if release-related.
- Verify gateway and role shells.
- Verify critical report details and dashboard screens.

Do-not-do warnings:

- Do not modify backend or database for a frontend asset incident unless backend checks independently fail.

## 5. Database Unavailable

Detection:

- API logs show database connection errors.
- Platform health reports database offline.
- Prisma errors spike.

Immediate containment:

- Stop deployments and migrations.
- Preserve logs.
- Verify infrastructure health using approved read-only channels.

Evidence to collect:

- API error logs.
- Database service status.
- Current backend commit.
- Recent maintenance or deployment actions.
- Latest recovery set ID and verification status.

Escalation:

- Incident Lead.
- Backup Operator.
- Restore Approver if recovery may be needed.
- Application Owner for service-impact decision.

Recovery path:

- Restore service connectivity if infrastructure issue.
- Roll back backend only if code release caused database failure.
- Consider production restore only under explicit emergency authorization.

Do-not-do warnings:

- Do not run migrations.
- Do not run destructive SQL.
- Do not restore into production without approval.
- Do not expose connection strings.

## 6. Evidence Images Missing

Detection:

- Report evidence or completion evidence fails to render.
- Users report missing images.
- Evidence counts drop unexpectedly.

Immediate containment:

- Stop deployments that could affect storage.
- Do not upload replacement files manually.
- Do not delete or move upload directories.

Evidence to collect:

- Affected report IDs.
- Evidence route status codes.
- Current `UPLOAD_ROOT` value label, not secret data.
- Mount source/destination evidence.
- Host and container file counts.
- Sample missing relative paths.

Escalation:

- Incident Lead.
- Backup Operator.
- Application Owner.

Recovery path:

- Verify persistent mount.
- Verify database references.
- Verify files exist under upload root.
- If files are missing, compare against latest verified recovery set.
- Use isolated restore rehearsal evidence before any production recovery decision.

Do-not-do warnings:

- Do not delete orphan-looking files during incident triage.
- Do not rewrite database paths.
- Do not expose evidence files publicly.

## 7. Persistent Upload Mount Missing

Detection:

- Container `/app/uploads` is empty or unexpectedly reset.
- Host mount is absent from container mount list.
- New container cannot see existing evidence.

Immediate containment:

- Stop redeployments.
- Preserve current container state.
- Avoid writing new evidence until mount status is understood.

Evidence to collect:

- Expected host path.
- Container mount destination.
- File counts on host and container.
- API health and upload-related logs.
- Recent Dokploy/server configuration changes.

Escalation:

- Incident Lead.
- Release Operator.
- Application Owner.

Recovery path:

- Restore durable mount configuration through approved infrastructure process.
- Verify evidence visibility through protected routes.
- Resume writes only after mount path is correct.

Do-not-do warnings:

- Do not copy files manually into a replacement container as the final fix.
- Do not clear `/app/uploads`.
- Do not treat empty container storage as evidence deletion until host path is checked.

## 8. Disk Near Full

Detection:

- Host or container storage usage breaches threshold.
- Uploads or backups fail due to space.
- API logs show filesystem write errors.

Immediate containment:

- Stop non-essential deployments and backups.
- Prevent large new evidence intake if operationally approved.
- Preserve existing uploads and backups.

Evidence to collect:

- Disk usage by filesystem.
- Upload directory size.
- Backup directory size.
- Recent growth trend if available.

Escalation:

- Incident Lead.
- Backup Operator.
- Application Owner.

Recovery path:

- Add capacity or move approved backup artifacts through governed process.
- Apply retention only if policy exists and owner approves.
- Verify API and upload health after capacity relief.

Do-not-do warnings:

- Do not delete uploads.
- Do not delete the latest valid recovery set.
- Do not run broad cleanup commands without path verification.

## 9. Backup Failure

Detection:

- Backup command fails.
- Dump/archive missing or zero bytes.
- Checksum generation fails.
- Manifest incomplete.

Immediate containment:

- Mark recovery set `INVALID`.
- Preserve failed logs and artifacts for diagnosis.
- Do not use failed artifacts for restore.

Evidence to collect:

- Recovery Set ID.
- Failed step.
- Exit status.
- Non-secret log excerpt.
- Available disk and service health.

Escalation:

- Backup Operator.
- Incident Lead.
- Application Owner if no recent valid backup exists.

Recovery path:

- Fix underlying cause.
- Rerun backup only through approved procedure.
- Verify database and uploads artifacts.

Do-not-do warnings:

- Do not mark partial backup as valid.
- Do not mix artifacts from different recovery set IDs.
- Do not publish logs containing secrets.

## 10. Restore Verification Failure

Detection:

- Isolated restore fails.
- Evidence consistency check reports critical mismatch.
- Temporary app cannot start against restored data.

Immediate containment:

- Keep rehearsal environment intact.
- Mark recovery set `INVALID` or `UNVERIFIED` as appropriate.
- Stop any plan to rely on that recovery set.

Evidence to collect:

- Recovery Set ID.
- Failed verification step.
- Counts and mismatch summary.
- Restore logs without secrets.

Escalation:

- Restore Approver.
- Backup Operator.
- Incident Lead.

Recovery path:

- Diagnose artifact, manifest, or procedure defect.
- Select a different verified recovery set if available.
- Update backup procedure before next rehearsal.

Do-not-do warnings:

- Do not tear down rehearsal target before evidence is captured.
- Do not repair restored data silently.
- Do not use failed rehearsal artifacts for production recovery.

## 11. Failed Deployment

Detection:

- Health check fails after deployment.
- Role smoke tests fail.
- Error rates spike.
- Evidence routes regress.

Immediate containment:

- Freeze further deployments.
- Preserve failed release logs.
- Identify release window and changed commit/image.

Evidence to collect:

- Backend and frontend commit/build IDs.
- Health responses.
- Logs.
- Failed smoke checks.
- Upload mount verification.

Escalation:

- Incident Lead.
- Release Operator.
- Application Owner.

Recovery path:

- Roll back backend or frontend according to the operations runbook.
- If migration occurred, follow separate migration governance.
- Verify post-rollback health and smoke tests.

Do-not-do warnings:

- Do not run a new migration to patch an unknown failed deployment.
- Do not delete uploads.
- Do not restore database unless data corruption is confirmed and approved.

## 12. Unexpected Evidence-Count Drop

Detection:

- Dashboard or review screen shows fewer evidence items than expected.
- Completion evidence count changes unexpectedly.
- Report evidence and completion evidence appear mixed or missing.

Immediate containment:

- Stop code or data changes affecting evidence.
- Preserve affected report IDs.
- Verify whether this is UI rendering, API authorization, database reference, or storage issue.

Evidence to collect:

- Affected report IDs.
- Expected and observed counts.
- API response shape where safe.
- Relative evidence paths.
- Mount and file-count evidence.

Escalation:

- Incident Lead.
- Application Owner.
- Release Operator if linked to recent deployment.

Recovery path:

- Verify current report data and protected evidence authorization.
- Verify files under upload root.
- Compare against restored backup in an isolated rehearsal if needed.

Do-not-do warnings:

- Do not merge citizen report evidence and provider completion evidence.
- Do not rewrite evidence arrays manually.
- Do not expose protected media publicly.
