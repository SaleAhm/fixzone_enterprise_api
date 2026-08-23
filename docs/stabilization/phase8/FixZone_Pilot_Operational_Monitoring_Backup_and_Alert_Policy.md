# FixZone Pilot Operational Monitoring, Backup, and Alert Policy

Date: 2026-08-22

Scope: Approved Phase 8 Tranche 1 pilot operating policy baseline for FixZone host monitoring, backup cadence, freshness thresholds, checksum verification, restore rehearsal cadence, scheduler design, host-local heartbeat state, alert deduplication, and retention planning.

This document approves the pilot operating policy baseline only. It does not create a production schedule, activate runtime thresholds, configure alert delivery, create backups, delete backups, restore data, deploy code, migrate the database, repair historical evidence, access production, or mutate production data.

## 1. Approved Pilot Policy

Operator decision:

```text
APPROVED PILOT OPERATING POLICY: Balanced / Option B
```

Backend baseline:

```text
89df3a1 feat: add external host operational monitoring foundation
```

Frontend baseline:

```text
fea81ea feat: add super admin operational health ui path
```

Approved values:

- Backup cadence: daily coordinated PostgreSQL plus uploads recovery set.
- Backup freshness `WARNING`: `30 hours`.
- Backup freshness `CRITICAL`: `48 hours`.
- Host monitor cadence: every `15 minutes`.
- Checksum verification: after every successful backup/recovery-set creation.
- Restore rehearsal: monthly during pilot.
- Change-triggered restore rehearsal: after major Prisma/schema/storage changes, backup-system changes, evidence-storage architecture changes, and before major pilot expansion.
- Scheduler: systemd timer on the Hostinger Ubuntu VPS.
- Retention target: 7 daily recovery points, 4 weekly recovery points, 3 monthly recovery points.
- Initial alert architecture: structured logs plus host-local JSON status/heartbeat state.
- Citizen/provider notification stream integration: not approved.
- Paid email/SMS/push provider integration: not approved.

Policy status:

- This is an approved pilot operating policy.
- This is not a contractual SLA.
- Formal RPO is not yet approved.
- Formal RTO is not yet approved.
- Daily backup is an operating control, not a contractual recovery guarantee.

## 2. Current Verified Monitoring State

Backend deployment:

```text
89df3a1 deployed successfully through Dokploy.
```

Application operational health:

- Protected endpoint: `GET /api/platform-tools/operational-health`.
- Super Admin production result: HTTP `200`.
- Operational-health preflight: `204`.
- Database: `HEALTHY`.
- Database latency: `2 ms`.
- Upload storage: `HEALTHY`.
- Upload canary: `Removed`.
- Upload files: `28` current baseline.
- Capacity: `HEALTHY`.
- Free space: `48%`.
- Backup visibility: `UNKNOWN` because external policy inputs were not configured.

First supervised host-monitor execution:

- Verdict: `PASS`.
- Script copy: `/srv/securezone-ops/fixzone/89df3a1/fixzone_operational_check.sh`.
- Exit code: `3`.
- Classification: `UNKNOWN BY DESIGN`.
- Reasons: freshness thresholds unset, checksum verification not executed in routine monitoring cycle, restore-rehearsal evidence not directly visible to monitor.

Production remained safe:

- Host/container uploads matched.
- Current files: `28 / 28`.
- Current size: approximately `2.6M / 2.6M`.
- Canary residue: `0 / 0`.
- API remained healthy after run.
- Verified recovery set remained preserved.
- No monitoring schedule exists yet.

## 3. Backup Job Validity Contract

Each future scheduled recovery set must bind these artifacts:

- PostgreSQL custom-format dump.
- Uploads archive.
- `checksums.sha256`.
- Recovery manifest.
- Database TOC listing.
- Uploads listing.
- Backup start and end timestamps.
- Recovery ID.
- Backend version metadata where available.
- Frontend version metadata where available.

Required status values:

- `SUCCESS`: all required artifacts are present, non-zero, coherently paired, and checksum verification succeeded.
- `FAILED`: backup job did not complete or a required operation failed before a valid recovery set was produced.
- `PARTIAL_INVALID`: one or more artifacts are missing, zero-size, incoherent, or checksum verification failed.

The scheduled backup must prefer `FAILED` or `PARTIAL_INVALID` over falsely claiming a valid recovery set.

## 4. Freshness-State Contract

Age comparison uses the latest structurally valid recovery set timestamp.

- `HEALTHY`: age is less than `30 hours`.
- `WARNING`: age is greater than or equal to `30 hours` and less than `48 hours`.
- `CRITICAL`: age is greater than or equal to `48 hours`.
- `UNKNOWN`: threshold/config metadata is unavailable or the latest recovery set cannot be safely determined.

Override rules:

- Required artifact missing or zero-size: `CRITICAL` regardless of age.
- Checksum failure: `CRITICAL` regardless of age.
- Checksum not yet executed under an approved after-backup policy: `WARNING` after one monitor cycle grace; `UNKNOWN` before the after-backup policy is technically implemented.
- Restore rehearsal age remains a separate signal and does not by itself redefine backup freshness.

Do not activate these thresholds until implementation is separately approved.

## 5. Checksum-State Contract

Approved checksum policy:

```text
Verify checksums after every successful backup/recovery-set creation.
```

States:

- `SUCCESS`: all required checksums pass.
- `CRITICAL`: checksum mismatch.
- `INVALID`: required checksum manifest or required artifact is absent.
- `UNKNOWN`: checksum verification status is not visible to the routine monitor.

No checksum verification is run by this documentation task.

## 6. systemd Monitor Service Design

Unit name:

```text
fixzone-host-monitor.service
```

Type:

```text
Type=oneshot
```

User/root requirement:

- The monitor needs permission to run `docker ps`, `docker inspect`, and read host backup/upload paths.
- On the current VPS this may require `root` or a dedicated `fixzone-ops` user in the Docker group with read permission to `/srv/securezone-data/fixzone/uploads` and `/srv/securezone-backups/manual`.

Working directory:

```text
/srv/securezone-ops/fixzone/current
```

ExecStart design:

```text
/srv/securezone-ops/fixzone/current/fixzone_operational_check.sh
```

Environment/config strategy:

- Use a root-readable config file such as `/etc/fixzone/host-monitor.env`.
- Store only non-secret values: health URL, expected upload paths, freshness thresholds, backup root, state directory.
- Do not store database credentials, tokens, cookies, private keys, or SMTP credentials in the monitor config.

Logging:

- Write structured stdout/stderr to journald.
- Later, write `latest-status.json` and `heartbeat.json` under `/srv/securezone-ops/fixzone/state/` after heartbeat support is implemented.

Timeout:

```text
TimeoutStartSec=120
```

Failure behavior:

- Non-zero exit codes should be recorded by systemd/journald.
- Do not use `Restart=always` for this scheduled one-shot job.
- A future watchdog should detect missed runs through heartbeat age rather than service restart loops.

Compatible hardening options to evaluate:

- `NoNewPrivileges=true`.
- `PrivateTmp=true`.
- `ProtectSystem=full` if it does not block Docker/socket or required read paths.
- `ReadWritePaths=/srv/securezone-ops/fixzone/state` only after state output is implemented.

Local implementation package prepared for review:

```text
ops/systemd/fixzone-host-monitor.service
```

The service is repository-managed only and is not installed on production by this task.

Current service design:

- `Type=oneshot`.
- `User=root` / `Group=root` for the initial pilot because the monitor needs Docker inspection plus host upload and backup metadata access. A future dedicated `fixzone-ops` identity may be approved only if Docker and filesystem permissions are explicitly governed.
- `WorkingDirectory=/srv/securezone-ops/fixzone/current`.
- `ExecStart=/srv/securezone-ops/fixzone/current/fixzone_operational_check.sh`.
- `Environment=FIXZONE_MONITOR_STATE_DIR=/srv/securezone-ops/fixzone/state`.
- `Environment=FIXZONE_MONITOR_VERSION=c3e37fb`.
- Optional non-secret override file: `EnvironmentFile=-/etc/fixzone/host-monitor.env`.
- `SuccessExitStatus=1 2 3`, so monitor `WARNING`, `CRITICAL`, and `UNKNOWN` classifications are not treated as implementation crashes.
- `TimeoutStartSec=120`.
- No `Restart=always`.
- Journald remains the logging sink through stdout/stderr.
- No `Documentation=` directive is included in the production unit files because repository-relative Markdown paths are invalid systemd documentation URIs.

The optional `/etc/fixzone/host-monitor.env` file must contain only non-secret monitor configuration. It may later contain approved backup freshness variables, but this package does not activate the 30h/48h thresholds.

Version selection:

- Production monitor versions remain under `/srv/securezone-ops/fixzone/<commit>/`.
- `/srv/securezone-ops/fixzone/current` should be an atomically switched symlink to the approved version directory.
- Future upgrades install a new version directory, verify its checksum and monitor output, then atomically switch `current`.
- Rollback switches `current` back to the previous preserved version directory and manually runs the service once before any timer use.

State/heartbeat production verification:

- c3e37fb host-local state/heartbeat execution was production-verified as PASS.
- Observed state recorded monitorVersion `c3e37fb`, completed heartbeat, lastExitCode `3`, lastOverallState `UNKNOWN`, valid JSON, secret-field safety PASS, no temp-file residue, canary residue `0/0`, upload count `28/28`, and post-run API health PASS.
- The `UNKNOWN` result is expected until backup freshness thresholds and checksum verification execution are separately approved.

Systemd host monitor production verification: PASS.

- Installed monitor: `/srv/securezone-ops/fixzone/c3e37fb/fixzone_operational_check.sh`.
- Current symlink: `/srv/securezone-ops/fixzone/current -> /srv/securezone-ops/fixzone/c3e37fb`.
- State directory: `/srv/securezone-ops/fixzone/state`.
- Installed units: `/etc/systemd/system/fixzone-host-monitor.service` and `/etc/systemd/system/fixzone-host-monitor.timer`.
- VPS `systemd-analyze verify`: PASS.
- Manual service run: PASS.
- Timer: enabled and active.
- First timer-triggered execution: PASS.
- Systemd classification: successful completed oneshot.
- Monitor classification: `UNKNOWN` by design with lastExitCode `3`, lastOverallState `UNKNOWN`, monitorVersion `c3e37fb`, latest heartbeat completion `2026-08-23T10:11:52Z`.
- Canary residue remained `0/0`; uploads remained `28/28`; API remained healthy; no production evidence loss or mutation was observed.
- Thresholds are not yet active. Checksum verification visibility remains `UNKNOWN`.

Threshold activation package template: `ops/systemd/host-monitor.env.example`.

Approved runtime freshness values for future activation:

- `FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS=30`.
- `FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS=48`.

The service already loads optional non-secret host-local configuration from `/etc/fixzone/host-monitor.env`. The repository template is not the production file and does not activate thresholds by itself.

Threshold state contract:

- Backup age less than `30 hours`: `HEALTHY`.
- Backup age greater than or equal to `30 hours` and less than `48 hours`: `WARNING`.
- Backup age greater than or equal to `48 hours`: `CRITICAL`.
- Required recovery artifact missing or invalid recovery set: `CRITICAL`, regardless of age.
- Metadata unavailable: `UNKNOWN`.

Checksum visibility recommendation:

- Do not fake checksum `HEALTHY` when the monitor did not execute or read approved verification evidence.
- Keep checksum verification as a backup-job responsibility after every successful backup.
- The routine 15-minute monitor should read durable verification metadata/status from the recovery set when that format is approved, rather than performing expensive checksum verification every cycle.
- `FIXZONE_VERIFY_BACKUP_CHECKSUMS=true` remains an optional read-only monitor capability, not the preferred pilot cadence.

VPS systemd validation attempt: BLOCKED SAFELY BEFORE INSTALLATION.

Findings:

- The first validation gate stopped at `systemd-analyze verify` before unit installation or activation.
- The unit package used invalid repository-relative `Documentation=docs/...` paths. systemd expects supported URI forms, so those directives were removed instead of inventing a public URL.
- `systemd-analyze verify` was attempted before `/srv/securezone-ops/fixzone/current` existed, so the approved `ExecStart=/srv/securezone-ops/fixzone/current/fixzone_operational_check.sh` could not be resolved.
- Classification: installation procedure / unit metadata defect, not monitor runtime failure, application failure, production data failure, or backup failure.
- No timer was enabled, no threshold was activated, and no production schedule was created by this blocked attempt.
- Removed invalid repository-relative `Documentation=docs/...` directives from the production unit files.

## 7. systemd Monitor Timer Design

Timer name:

```text
fixzone-host-monitor.timer
```

Cadence:

```text
OnBootSec=5min
OnUnitActiveSec=15min
AccuracySec=1min
Persistent=true
```

Behavior:

- Triggers the one-shot monitor service.
- Does not overlap monitor runs; systemd will not start a second instance while the service is still active.
- Does not activate until separately approved and created on the VPS.

Local implementation package prepared for review:

```text
ops/systemd/fixzone-host-monitor.timer
```

Chosen scheduling semantic:

- Use `OnUnitActiveSec=15min` for the pilot timer because it schedules relative to the service activation cycle and pairs naturally with a one-shot monitor.
- `OnCalendar` would provide stricter wall-clock alignment, but wall-clock predictability is less important than a simple recurring health cadence for this pilot.
- systemd will not start a second instance of the same one-shot service while the previous run is still active; a long run therefore does not create unsafe concurrent monitor executions.

Manual installation gate for future approval:

1. Verify `/srv/securezone-ops/fixzone/c3e37fb/fixzone_operational_check.sh` exists.
2. Verify the monitor script syntax and checksum.
3. Create or verify `/srv/securezone-ops/fixzone/state`.
4. Create or verify `/srv/securezone-ops/fixzone/current` points to the approved version.
5. Download or copy the candidate service and timer unit files into a review location.
6. Run `systemd-analyze verify` against the candidate unit files while the current symlink exists.
7. Install the service and timer units into the systemd unit directory.
8. Run `systemd-analyze verify` against the installed units.
9. Run `systemctl daemon-reload`.
10. Confirm the timer is disabled and inactive.
11. Stop for separate manual first-service-run approval.
12. Manually run the service once only after that approval.
13. Inspect `systemctl status`, `journalctl`, `latest-status.json`, and `heartbeat.json`.
14. Verify API health.
15. Verify upload counts.
16. Verify canary residue `0/0`.
17. Enable the timer only after separate approval.
18. Observe the first timer-triggered execution.

Versioned monitor executable installation requirement:

```text
install -o root -g root -m 0755 <verified-source> <versioned-target>
```

- Do not rely on `curl` preserving Git executable mode.
- Verify SHA-256 before and after executable-mode correction; changing the executable bit must not alter the content hash.
- systemd direct `ExecStart` requires the target script to be executable.

Future threshold activation gate:

1. Verify the timer is currently healthy and active.
2. Capture heartbeat and latest-status baseline.
3. Create `/etc/fixzone` if absent.
4. Install approved `/etc/fixzone/host-monitor.env` with `root:root` ownership and mode `0644`.
5. Verify the file contains only approved non-secret operational values.
6. Run `systemctl daemon-reload` if the service environment handling changed.
7. Manually run the service once.
8. Inspect `latest-status.json` and `heartbeat.json`.
9. Confirm backup freshness is no longer `UNKNOWN` solely because thresholds are missing.
10. Verify canary residue `0/0`.
11. Verify host/container upload consistency.
12. Verify API health.
13. Confirm the timer remains active.
14. Observe one timer-triggered execution.
15. Capture evidence.

This document records the activation procedure only. It does not activate thresholds, create backups, delete backups, restore data, configure alert delivery, or mutate production.

Rollback procedure:

- Stop and disable the timer if required.
- Preserve state and journal evidence.
- Atomically switch `/srv/securezone-ops/fixzone/current` back to the previous version directory.
- Run `systemctl daemon-reload` only if unit files changed.
- Manually test the previous monitor before restoring timer use.
- Never touch production uploads or backups during monitor rollback.

## 8. Future Backup Service/Timer Design

Future unit names:

```text
fixzone-recovery-backup.service
fixzone-recovery-backup.timer
```

Type:

```text
Type=oneshot
```

Cadence:

- Daily after operator approval.
- Suggested unapproved window: low-traffic overnight window.

Backup service contract:

- Create coordinated PostgreSQL custom-format dump and uploads archive.
- Generate database TOC listing and uploads listing.
- Generate `checksums.sha256`.
- Generate recovery manifest with recovery ID, timestamps, artifact names, backend/frontend version metadata where available, and status.
- Mark result `SUCCESS`, `FAILED`, or `PARTIAL_INVALID`.
- Run checksum verification after artifact creation.
- Never delete existing recovery sets as part of initial backup creation.

This design is not implemented or scheduled by this document.

## 9. Host-Local State / Heartbeat Design

Approved pilot state architecture:

```text
/srv/securezone-ops/fixzone/state/
```

Implementation status:

```text
LOCAL IMPLEMENTATION FOR REVIEW ONLY
```

The monitor now supports `FIXZONE_MONITOR_STATE_DIR`. If it is not configured, the host-oriented default is `/srv/securezone-ops/fixzone/state`. Tests override this value with temporary fixture directories. No production state directory is created by this local implementation task.

Files:

```text
latest-status.json
heartbeat.json
```

Ownership boundary:

- The monitor owns only `latest-status.json`, `heartbeat.json`, and its own temporary files used during atomic replacement.
- It must not delete unrelated files in the configured state directory.

Suggested `latest-status.json` fields:

- `timestamp`.
- `monitorVersion`.
- `overallState`.
- `apiState`.
- `serviceState`.
- `mountState`.
- `uploadConsistencyState`.
- `diskState`.
- `backupPresenceState`.
- `backupFreshnessState`.
- `backupVerificationState`.
- `canaryResidueState`.
- `alertKeys`.
- `exitCode`.

Suggested `heartbeat.json` fields:

- `lastStartedAt`.
- `lastCompletedAt`.
- `lastExitCode`.
- `lastOverallState`.
- `lastHealthyAt`.
- `lastWarningAt`.
- `lastCriticalAt`.
- `lastUnknownAt`.
- `lastAlertedByKey`.

Do not include:

- secrets;
- `DATABASE_URL`;
- credentials;
- tokens;
- cookies;
- private keys;
- private evidence data.

JSON write behavior:

- JSON is generated by the Bash monitor with explicit string escaping; no new `jq` host dependency is required.
- Writes use a same-directory temporary file followed by atomic replacement.
- Successful runs must not leave monitor temp files behind.

Start/completion behavior:

- At start, `heartbeat.json` records `lastStartedAt`.
- At completion, `latest-status.json` records the completed cycle and `heartbeat.json` records `lastCompletedAt`, `lastExitCode`, `lastOverallState`, and the matching lastHealthyAt/lastWarningAt/lastCriticalAt/lastUnknownAt timestamp.
- If the monitor is interrupted before completion, the start heartbeat remains but `latest-status.json` is not refreshed and `lastCompletedAt` is not falsely advanced.

Exit-code interaction:

- State persistence does not change the operational check results.
- If state persistence fails during an otherwise `HEALTHY` run, the process exits `WARNING`.
- If the operational result is already `WARNING`, `CRITICAL`, or `UNKNOWN`, that operational exit classification is preserved and the state persistence failure is reported locally.

No schedule, threshold activation, alert delivery, backup creation, backup deletion, restore, production repair, or production mutation is performed by this implementation.

## 10. Missed-Run Policy

Approved monitor cadence:

```text
15 minutes
```

Proposed missed-run thresholds:

- `WARNING`: no completed monitor run for more than `30 minutes`.
- `CRITICAL`: no completed monitor run for more than `60 minutes`.

Rationale:

- `30 minutes` is two missed 15-minute intervals and catches drift quickly without panicking on one delayed run.
- `60 minutes` is four missed intervals and should be treated as a monitoring outage during pilot operations.

Do not activate missed-run detection until heartbeat support and scheduler ownership are approved.

## 11. Alert Deduplication Policy

First occurrence:

- Record immediately when a check first enters `WARNING` or `CRITICAL`.
- Record `UNKNOWN` visibly but do not emergency-escalate on first occurrence.

Repeat reminder:

- Identical persistent `WARNING`: remind every `6 hours`.
- Identical persistent `CRITICAL`: remind every `30 minutes`.
- Persistent `UNKNOWN`: remind/escalate every `2 hours` if still unresolved.

Escalation:

- `HEALTHY -> WARNING`: immediate event.
- `WARNING -> CRITICAL`: immediate event.
- `UNKNOWN -> CRITICAL`: immediate event.
- Any new `CRITICAL` alert key: immediate event.

Recovery:

- Emit one recovery event when a previously non-healthy check returns to `HEALTHY`.
- Include previous state and approximate duration when state history is available.

No external delivery is activated by this document.

## 12. Retention Dry-Run Design

Approved target:

- 7 daily recovery points.
- 4 weekly recovery points.
- 3 monthly recovery points.

Automatic deletion is not approved.

Future deterministic selector requirements:

- Never delete the newest valid recovery set.
- Never delete the last verified recovery set.
- Preserve required weekly and monthly anchors.
- Support dry-run mode.
- Log candidate deletions with recovery ID, age, classification, and reason.
- Require explicit activation before deletion.
- Prefer preserving ambiguous recovery sets until an operator classifies them.

No backup deletion is performed or implemented by this document.

## 13. Restore-Rehearsal Governance

Approved pilot cadence:

```text
Monthly during pilot.
```

Additional restore rehearsal triggers:

- Major Prisma/schema changes.
- Storage architecture changes.
- Evidence-storage architecture changes.
- Backup implementation changes.
- Before major pilot expansion.

Current baseline evidence:

- Recovery set: `/srv/securezone-backups/manual/fixzone-v1-baseline-2026-08-22_15-53-38`.
- Recovery rehearsal: PASS.
- Database restore: PASS.
- Uploads restore: PASS.
- Production/restored upload tree: identical.
- Rehearsal cleanup: PASS.

No restore rehearsal is performed by this document.

## 14. RPO / RTO Language

Formal RPO:

```text
NOT YET APPROVED
```

Formal RTO:

```text
NOT YET APPROVED
```

The daily backup cadence is an operating control, not a contractual recovery guarantee.

Same-day restore remains an aspiration until repeated rehearsal timing evidence exists and the operator formally approves RTO language.

## 15. Controlled Implementation Order

1. Documentation approval checkpoint.
2. Host-local state/heartbeat support in the monitor.
3. Threshold configuration support for the approved 30-hour and 48-hour backup freshness policy.
4. Draft systemd host-monitor one-shot service.
5. Draft systemd 15-minute monitor timer.
6. First supervised timer run.
7. Backup automation design and implementation.
8. Checksum-after-backup implementation.
9. Backup scheduling.
10. Retention dry-run implementation.
11. Alert delivery later.
12. Monthly restore cadence governance.

Approval gates:

- Gate 1: commit approved policy documentation.
- Gate 2: approve monitor state/heartbeat source changes.
- Gate 3: approve threshold activation values in runtime config.
- Gate 4: approve systemd unit/timer creation on VPS.
- Gate 5: approve first supervised scheduled run.
- Gate 6: approve backup automation source/design.
- Gate 7: approve backup schedule.
- Gate 8: approve retention dry-run.
- Gate 9: approve any deletion enforcement.
- Gate 10: approve any email/SMS/push delivery.
- Gate 11: approve formal RPO/RTO.

## 16. Remaining P0/P1 Items

P0:

- Commit the approved policy documentation.
- Implement monitor state/heartbeat support after approval.
- Approve and create systemd units after review.
- Capture first supervised timer-run evidence.
- Implement backup automation after design approval.
- Preserve historical evidence mismatch as unrepaired until separately approved.

P1:

- Formal RPO/RTO.
- Alert delivery integration.
- Operational status dashboard or backend ingestion endpoint.
- Retention dry-run and later deletion governance.
- Monthly restore rehearsal evidence.
- Rollback rehearsal evidence.

## 17. Final Recommendation

Use this policy as the Phase 8 Tranche 1 pilot operating baseline. Proceed next with a documentation checkpoint commit, then implement host-local state/heartbeat support before creating any systemd schedule or activating freshness thresholds.
