# FixZone External Host Monitoring and Alert Routing Design

Date: 2026-08-22

Scope: Phase 8 Tranche 1 design and local implementation review for external host-level monitoring, backup freshness visibility, alert-state generation, and alert routing foundation.

This document does not authorize production access, deployment, migration, backup creation, restore execution, production repair, file deletion, service restart, or alert-provider activation.

## 1. Production-Verified Application Monitoring State

Application-level operational health is production verified as `PASS WITH EXPECTED UNKNOWN EXTERNAL DEPENDENCY`.

Verified through authenticated Super Admin UI:

```text
GET /api/platform-tools/operational-health
HTTP 200
Preflight 204
```

Observed production values:

- Overall state: `UNKNOWN`.
- Database: `HEALTHY`.
- Database latency: `2 ms`.
- Upload storage: `HEALTHY`.
- Upload canary: `Removed`.
- Upload files: `28`.
- Upload size: `2.4 MB` in the application response.
- Capacity: `HEALTHY`.
- Free space: `48%`.
- Backup visibility: `UNKNOWN`.

The `UNKNOWN` overall state is legitimate because external operational-backup freshness is not fully visible to application runtime and no approved freshness SLA has been set.

Previously verified host evidence:

- Host upload path: `/srv/securezone-data/fixzone/uploads`.
- Container upload path: `/app/uploads`.
- Mount type: `bind`.
- Host/container upload file counts: `28 / 28`.
- Host/container upload storage: approximately `2.6M / 2.6M`.
- API health: PASS.
- Operational-health canary residue: `0` container, `0` host.

The value `28` is a production-verified baseline, not a fixed expected count. Monitoring must compare current host and container values, not historic baseline values.

## 2. Existing Capability Findings

Application capability:

- Public liveness exists at `GET /api/health` and intentionally returns only minimal process status.
- Protected operational health exists at `GET /api/platform-tools/operational-health` for authenticated Super Admin users.
- Application checks cover database reachability, configured upload-root access, temporary write/read/delete canary behavior, disk capacity where supported, metadata snapshot visibility, and provider-neutral alert state.
- Application runtime cannot prove Docker host bind source identity.

Repository operations capability:

- No committed general-purpose host monitoring script existed before this tranche.
- Deployment and backup operational behavior exists only in the protected untracked release script, which must remain untouched.
- Phase 8 runbooks and recovery evidence describe backup, restore, mount, incident, and rollback requirements.

Backup freshness capability:

- Platform Tools metadata snapshots are not full operational recovery sets.
- The verified recovery set is `/srv/securezone-backups/manual/fixzone-v1-baseline-2026-08-22_15-53-38`.
- A recovery set must include PostgreSQL dump, uploads archive, checksums, and manifest material before it can be treated as structurally present.
- A structurally present recovery set is not automatically fully recoverable. Isolated restore rehearsal remains the stronger proof.
- Formal RPO/RTO values are not yet approved; freshness thresholds must be configurable and absent thresholds must produce `UNKNOWN`, not `HEALTHY`.

Alert-routing capability:

- User-facing Notification records exist for product workflows.
- Operational infrastructure alerts should not be inserted into citizen/provider notification streams by default.
- The safest V1 foundation is a provider-neutral alert result emitted by an external script as structured output and logs.

## 3. Recommended V1 Architecture

Recommended architecture: repository-managed read-only shell script plus documentation-only operator procedure, scheduled externally only after operator approval.

The script is application-independent and complements the protected application endpoint:

- Application endpoint checks what the API can truthfully observe from inside runtime.
- Host script checks Docker service discovery, host bind mount identity, host/container upload consistency, host disk capacity, recovery-set presence, optional checksum verification, and freshness thresholds.
- Alert events are emitted as structured key-value output for later ingestion by logs, cron/systemd mail, Dokploy scheduled task logs, or a future operational event store.

Do not make the first V1 alert route a citizen/provider notification. Future application integration should use a separate operational event model or external monitoring store unless a deliberate Super Admin operational inbox is approved.

## 4. External Host Check Contract

API check:

- Perform a safe HTTP request to the public health endpoint.
- Expected result is a reachable 2xx status.
- Failure is `CRITICAL`.

Container/service check:

- Discover the API container by explicit name or configured name pattern.
- Do not depend permanently on a single container ID.
- Missing service is `CRITICAL`.
- Docker unavailable or insufficient permissions is `UNKNOWN`.

Bind-mount identity check:

- Inspect Docker mounts for the API container.
- Expected type: `bind`.
- Expected host source: `/srv/securezone-data/fixzone/uploads`.
- Expected container destination: `/app/uploads`.
- Missing or mismatched mount is `CRITICAL`.

Upload consistency check:

- Count current host files.
- Count current container-visible files.
- Measure current host and container-visible upload tree size.
- Compare current values only.
- Mismatch is `CRITICAL`; do not compare against the historic `28` baseline as a permanent expected count.

Canary residue check:

- Search host and container upload roots for `.fixzone-operational-health-canary-*`.
- Zero residue is `HEALTHY`.
- Non-zero residue is `WARNING`.
- The script must not delete residue automatically.

Disk/capacity check:

- Read host filesystem capacity for the upload path.
- Use configurable warning and critical free-space thresholds.
- Current local defaults mirror the application operational thresholds: warning at or below `15%` free, critical at or below `5%` free.

Recovery-set discovery:

- Discover the newest `fixzone-v1-baseline-*` directory under the configured backup root.
- Default backup root: `/srv/securezone-backups/manual`.
- Missing recovery set is `CRITICAL`.

Recovery-set validity:

- PostgreSQL dump exists and is non-zero.
- Uploads archive exists and is non-zero.
- Checksum manifest exists and is non-zero.
- Recovery manifest exists and is non-zero.
- Artifact names are paired in a coherent recovery-set directory.
- Optional checksum verification can be executed safely with `sha256sum -c`.
- Restore rehearsal evidence is a separate state and should not be inferred from filenames alone.

Backup freshness:

- Freshness warning and critical thresholds are configurable.
- If thresholds are absent, backup freshness is `UNKNOWN`.
- A recent file is not proof of recoverability.

Alert states:

- `HEALTHY`: check passed.
- `WARNING`: threshold concern or incomplete verification that requires operator review.
- `CRITICAL`: dependency unavailable, unsafe, or required artifact missing.
- `UNKNOWN`: unsupported check, insufficient permissions, missing threshold, or unavailable verification metadata.

Exit codes:

- `0`: overall `HEALTHY`.
- `1`: overall `WARNING`.
- `2`: overall `CRITICAL`.
- `3`: overall `UNKNOWN` or configuration issue.

Severity precedence:

```text
CRITICAL > WARNING > UNKNOWN > HEALTHY
```

## 5. Alert Routing Foundation

Recommended V1 routing order:

1. Structured script output captured by scheduler logs.
2. Operator-visible status record or runbook evidence note.
3. Email delivery after SMTP ownership, templates, and throttling are approved.
4. SMS or push delivery later, after paid/provider integrations are explicitly approved.

Alert event payload should include:

- timestamp;
- overall state;
- check states;
- safe summaries;
- configured thresholds;
- non-secret operational paths where operator-only logs permit them;
- alert list;
- auto-remediation flag set to `false`.

Do not route infrastructure alerts into citizen/provider notification streams unless a separate product decision approves that behavior.

## 6. Scheduling Recommendation

Recommended initial execution strategy:

- Manual operator check immediately after deployments and during incident triage.
- Then systemd timer, cron, Dokploy scheduled task, or external monitoring job after approval.

Suggested unapproved starting cadence:

- API/service/mount/disk/upload consistency: every 5 to 15 minutes.
- Backup freshness: hourly.
- Full restore rehearsal: not scheduled in the script; run separately on approved cadence.

No cadence is approved by this document.

## 7. Implemented Local Script

Script:

```text
scripts/operations/fixzone_operational_check.sh
```

Safety properties:

- Read-only.
- Does not restart services.
- Does not delete files.
- Does not create backups.
- Does not restore backups.
- Does not run migrations.
- Does not modify database or uploads.
- Does not print environment variables, credentials, tokens, cookies, or auth headers.
- Does not touch the protected release script.

The script may read:

- public API health;
- Docker container and mount metadata;
- host and container upload file counts and sizes;
- host disk capacity;
- recovery-set artifact metadata;
- checksums only when explicitly requested through configuration.

## 8. Remaining P0/P1 Items

P0 remains open:

- Approve operational owner for host monitoring.
- Approve production execution schedule.
- Approve alert recipient and escalation policy.
- Verify script on the VPS under operator supervision.
- Capture first production host-monitoring evidence.
- Keep historical evidence mismatch classified and unrepaired until separately approved.

P1 remains open:

- Formal RPO/RTO.
- Backup schedule and retention policy.
- Automated backup success/failure alerts.
- Operational alert store or Super Admin operational inbox design.
- Recurring restore rehearsal cadence.
- Rollback rehearsal evidence.

## 9. Final Recommendation

Use the host script as a read-only V1 operational monitor after review. Keep application operational health and external host monitoring distinct. Backup freshness thresholds are now production-verified active at `30`/`48` hours; treat recovery-set checksum validity as `UNKNOWN` unless durable checksum verification metadata is present.

Policy proposal follow-up:

- `docs/stabilization/phase8/FixZone_Monitoring_Alerting_Backup_Policy_Proposal.md` records the first supervised production monitor run and proposes backup cadence, freshness thresholds, checksum verification, restore rehearsal, alert routing, deduplication, missed-run detection, scheduler, and retention policies.
- That proposal is not an approval to schedule the monitor, activate thresholds, send alerts, delete backups, create backups, restore data, or mutate production.

Approved pilot policy follow-up:

- `docs/stabilization/phase8/FixZone_Pilot_Operational_Monitoring_Backup_and_Alert_Policy.md` records the operator-approved Balanced / Option B pilot policy baseline.
- Approval covers policy values only; it does not create a systemd timer, activate thresholds, configure alert delivery, create/delete backups, restore data, or mutate production.

Host-local state implementation follow-up:

- `scripts/operations/fixzone_operational_check.sh` now supports host-local machine-readable state through `FIXZONE_MONITOR_STATE_DIR`, defaulting to `/srv/securezone-ops/fixzone/state` for future host use.
- The monitor owns only `latest-status.json`, `heartbeat.json`, and its own same-directory temporary files while writing those two JSON files.
- `latest-status.json` records the most recent completed monitor cycle: schema version, timestamp/completedAt, monitor version, environment, overall state, exit code, safe check states/summaries, and deduplicated alert objects.
- `heartbeat.json` records lastStartedAt immediately at run start, then lastCompletedAt, lastExitCode, lastOverallState, monitor version, and state-specific timestamps only after completion.
- State writes use a temp-file plus atomic rename pattern. A failed state write emits a local error and does not fake completion; a healthy operational run with state persistence failure exits `WARNING`, while existing non-healthy operational classifications are preserved.
- This implementation does not create a schedule, systemd unit, threshold activation, alert delivery route, backup, restore, deletion, production repair, or production mutation.

Systemd host-monitor package follow-up:

- The c3e37fb host-local state/heartbeat monitor was production-verified as PASS from `/srv/securezone-ops/fixzone/c3e37fb/fixzone_operational_check.sh`.
- Observed production state recorded monitorVersion `c3e37fb`, completed heartbeat fields, lastExitCode `3`, lastOverallState `UNKNOWN`, valid JSON, no temp-file residue, no secret-field leakage, canary residue `0/0`, upload count `28/28`, and post-run API health PASS.
- Repository-managed review-only unit files now live under `ops/systemd/`: `fixzone-host-monitor.service` and `fixzone-host-monitor.timer`.
- The service uses `/srv/securezone-ops/fixzone/current/fixzone_operational_check.sh`, writes state to `/srv/securezone-ops/fixzone/state`, and treats monitor exits `1`, `2`, and `3` as successful service execution statuses while leaving true execution failures visible to systemd.
- The timer package uses `OnBootSec=5min`, `OnUnitActiveSec=15min`, `AccuracySec=1min`, and `Persistent=true` for the approved 15-minute cadence. It is not installed or enabled by this repository change.
- Historical local systemd packaging did not activate thresholds. Current production threshold activation is verified separately as PASS; no backup automation, retention deletion, alert delivery, production mutation, deployment, push, or systemd activation is performed by this repository review package.
- VPS validation was blocked safely before installation because repository-relative `Documentation=docs/...` unit metadata was invalid and `/srv/securezone-ops/fixzone/current` did not yet exist when `systemd-analyze verify` was attempted. The package now omits invalid `Documentation=` directives and the docs require current symlink verification before systemd verification.

Systemd production verification and threshold activation follow-up:

- Host monitoring is production-verified as PASS with installed systemd service/timer, VPS `systemd-analyze verify` PASS, manual service run PASS, timer enabled and active, first timer-triggered execution PASS, and systemd successful completed oneshot classification.
- Backup freshness threshold activation is production-verified PASS with the approved `30` hour warning and `48` hour critical values active.
- Checksum verification visibility remains `UNKNOWN` by design because durable verification status is not yet read by the monitor.
- Production evidence after timer-triggered execution remained stable: heartbeat advanced at `2026-08-23T10:11:52Z`, canary residue `0/0`, uploads `28/28`, and API healthy.
- Repository template `ops/systemd/host-monitor.env.example` documents the active approved 30h/48h freshness threshold variable names and values while keeping secrets out of source control.
- Local recovery-backup implementation for review lives at `scripts/operations/fixzone_recovery_backup.sh`. It creates a new UTC recovery set, validates PostgreSQL custom dump structure through `pg_restore --list`, archives uploads without canary residue, writes `checksums.sha256`, verifies checksums immediately, and persists `verification-status.json` before publishing the set.
- PostgreSQL execution is now explicit: host-tool mode uses configured local `pg_dump` / `pg_restore`, while Docker Swarm mode requires `FIXZONE_POSTGRES_SERVICE`, resolves exactly one running task by `com.docker.swarm.service.name`, streams `pg_dump` output to the host dump file, and streams the host dump into container-local `pg_restore --list` for TOC validation.
- Docker Swarm backup mode also requires `FIXZONE_POSTGRES_USER` so `pg_dump` uses an explicit database role instead of inheriting the container execution OS user.
- Read-only production discovery verified the FixZone database service as `securezoneinfrastructure-postgres-bhwgzt:5432/postgres`, with credentials redacted. The service uses `postgres:17`, host-level PostgreSQL tooling is unavailable, and unrelated PostgreSQL services make generic discovery unsafe.
- First supervised production backup attempt failed safely at `pg_dump` role selection/authentication after capacity preflight, service resolution, and PostgreSQL major checks passed. No successful new-style recovery set was created; protected baseline, uploads `28/28`, canaries `0/0`, API health, and active host monitor timer were preserved; no retry was performed.
- Checksum verification should remain a backup-job responsibility after each successful backup, with the monitor reading approved durable verification metadata/status in a future package rather than performing expensive checksum verification every 15 minutes.
- Retention deletion is not approved. Future retention work should begin with an auditable dry-run selector for `7` daily, `4` weekly, and `3` monthly recovery points while preserving the newest valid and latest verified sets.
