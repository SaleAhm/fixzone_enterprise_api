# FixZone Mount Monitoring and Operational Alerting Design

Date: 2026-08-22

Scope: Phase 8 Tranche 1 operational monitoring foundation for persistent upload storage, API health, database reachability, storage capacity awareness, backup visibility, and provider-neutral alert states.

This document does not authorize production access, deployment, migration, backup execution, restore execution, historical repair, file deletion, service restart, or rehearsal cleanup.

## 1. Current Baseline

Backend baseline:

```text
d88f45d docs: record evidence hardening production verification
```

Deployed hardening baseline:

```text
71ac5ff fix: clean unpersisted evidence uploads on persistence failure
```

Verified production storage baseline:

- API health: PASS.
- `UPLOAD_ROOT`: `/app/uploads`.
- Persistent bind mount: PASS from host `/srv/securezone-data/fixzone/uploads` to container `/app/uploads`.
- Production file count: 28.
- Container file count: 28.
- Production storage: approximately 2.6M.
- Recovery rehearsal: PASS.
- Rehearsal cleanup: PASS.

The count of 28 files is a verified baseline, not a permanent expected production value.

## 2. Health Contract

### Public Liveness

Route:

```text
GET /api/health
```

Purpose:

- Confirm the API process is alive.
- Return only safe public service identity.

Public liveness must not expose:

- database hostnames;
- usernames;
- credentials;
- filesystem host paths;
- container IDs;
- internal network topology;
- backup locations;
- detailed exception stacks.

### Readiness

Readiness means the API can serve normal FixZone requests safely.

Minimum readiness dependencies:

- API process alive.
- Prisma/database read-only query succeeds.
- Configured upload root exists.
- Configured upload root is readable.
- Configured upload root is writable through a temporary canary.
- Canary deletion succeeds or cleanup failure is reported without deleting unrelated files.

### Operational Health

Route:

```text
GET /api/platform-tools/operational-health
```

Access:

- Authenticated Super Admin only.

Purpose:

- Provide operators with safe application-visible health signals.
- Generate provider-neutral alert state.
- Document what remains external/manual.

## 3. Implemented Application Checks

Database:

- Uses a simple read-only Prisma query.
- Records latency in milliseconds.
- Reports `CRITICAL` if unavailable.
- Returns only a safe error category, not the connection string or stack trace.

Upload storage:

- Uses the configured `UPLOAD_ROOT`.
- Confirms the path exists and is a directory.
- Confirms read/write access.
- Reads the directory.
- Writes one exclusive temporary canary file named `.fixzone-operational-health-canary-*`.
- Reads the canary file.
- Deletes the canary immediately.
- Reports upload file count and upload directory size.

The canary is never written into:

- `report-evidence/`
- `report-completion/`

Disk capacity:

- Uses runtime filesystem capacity support where available.
- Reports free percent, free bytes, total bytes, and configured thresholds.
- Defaults are operational thresholds, not product workflow logic.
- If the runtime cannot perform the check safely, the state is `UNKNOWN`.

Backup visibility:

- Reports Platform Tools metadata snapshot visibility only.
- Does not inspect arbitrary host backup paths.
- Does not inspect the protected recovery-set directory.
- Does not claim to verify operational PostgreSQL dump plus uploads archive freshness from application runtime.

## 4. Alert Severity Model

States:

- `HEALTHY`: check passed.
- `WARNING`: check passed but is approaching an operator-defined threshold.
- `CRITICAL`: dependency is unavailable or unsafe for normal operations.
- `UNKNOWN`: the check cannot be performed safely from application runtime.

Critical examples:

- database unavailable;
- upload root missing;
- upload root not a directory;
- upload root not writable;
- severe upload filesystem exhaustion.

Warning examples:

- upload filesystem free space approaches threshold;
- metadata backup visibility exceeds configured threshold.

Unknown examples:

- disk capacity is not supported by runtime;
- backup visibility is unavailable from application runtime;
- no approved backup freshness threshold is configured.

## 5. Mount Identity Limitation

The application can verify what it sees inside the container:

- configured `UPLOAD_ROOT`;
- directory existence;
- read/write behavior;
- canary cleanup;
- file count;
- directory size;
- filesystem capacity where supported.

The application cannot prove the Docker host bind source path from inside the container.

External operations monitoring must verify:

- host path `/srv/securezone-data/fixzone/uploads`;
- container path `/app/uploads`;
- mount type `bind`;
- host/container file count alignment;
- host/container storage-size alignment;
- disk free space on the host volume.

## 6. Backup Freshness Responsibility

Current RPO/RTO remains to be formally set.

The API must not invent a production backup freshness SLA.

Implemented behavior:

- Supports optional freshness thresholds through configuration.
- Reports metadata snapshot freshness if Platform Tools metadata backups exist.
- Marks backup freshness as `UNKNOWN` when no approved runtime-visible signal exists.

External operations should track:

- latest verified recovery-set timestamp;
- PostgreSQL dump presence;
- uploads archive presence;
- checksum verification;
- restore rehearsal cadence;
- backup job success/failure alerts.

Protected recovery evidence must remain untouched:

```text
/srv/securezone-backups/manual/fixzone-v1-baseline-2026-08-22_15-53-38
```

## 7. Manual Operator Response

If operational health is `CRITICAL`:

1. Stop planned releases.
2. Capture the health response and timestamp.
3. Check API container health.
4. Check database availability.
5. Check upload root existence and permissions.
6. Verify host-level mount identity externally.
7. Escalate to the incident lead.

Do not automatically:

- restart services;
- delete files;
- repair evidence;
- restore backups;
- mutate production data.

## 8. Future Work

Remaining Phase 8 Tranche 1 work:

- external host-level mount monitoring;
- backup job scheduling;
- backup freshness alerting;
- retention policy;
- rollback rehearsal;
- recurring restore cadence;
- historical integrity governance and classification;
- optional notification-provider integration after alert routing is approved.
