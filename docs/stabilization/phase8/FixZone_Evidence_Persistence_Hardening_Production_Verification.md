# FixZone Evidence Persistence Hardening Production Verification

Date: 2026-08-22

Scope: Phase 8 Tranche 1 documentation record for the production deployment verification of current evidence-persistence failure-path hardening.

This document does not authorize production access, deployment, migration, historical repair, rehearsal cleanup, evidence deletion, file copying, restore execution, or data mutation.

## 1. Verification Summary

Backend hardening commit:

```text
71ac5ff fix: clean unpersisted evidence uploads on persistence failure
```

Deployment record:

```text
f3468bf..71ac5ff main -> main
Dokploy status: Done
```

Production hardening deployment verification:

```text
PASS
```

## 2. Post-Deployment Checks Recorded

Active API container observed after deployment:

```text
ebc89a5f8ae1
```

API health:

```json
{"status":"ok","service":"fixzone-enterprise-api","apiPrefix":"/api"}
```

Result: PASS.

Upload root:

```text
/app/uploads
```

Result: PASS.

Persistent bind mount:

```text
Host: /srv/securezone-data/fixzone/uploads
Container: /app/uploads
Type: bind
```

Result: PASS.

Evidence/upload file counts after deployment:

```text
Container: 28
Host: 28
```

Result: PASS. Counts matched.

Storage size after deployment:

```text
Container /app/uploads: approximately 2.6M
Host /srv/securezone-data/fixzone/uploads: approximately 2.6M
```

Result: PASS. Storage remained consistent.

No evidence loss was observed during the container replacement/redeployment.

## 3. Hardened Failure Path

The deployed hardening protects current V1 citizen report evidence and provider completion evidence upload flows against the handled failure sequence where:

1. a physical evidence file is successfully created;
2. EvidenceRecord persistence subsequently fails.

The implementation attempts compensating cleanup of only request-created files that remain unpersisted.

The hardening:

- preserves original database or business exceptions;
- logs cleanup failure without replacing the original exception;
- uses upload-root path validation before deletion;
- performs only single-file deletion;
- does not recursively delete;
- does not delete outside `UPLOAD_ROOT`;
- does not delete pre-existing evidence;
- preserves already persisted evidence in multi-image workflows;
- does not alter authorization;
- does not require a Prisma schema migration.

This does not make filesystem writes and database writes fully atomic. A residual crash/process-kill window remains if the process terminates after file write and before compensating cleanup can execute.

## 4. Historical Integrity Finding

The historical evidence mismatch remains separate, unresolved, and unrepaired.

Known historical state:

- EvidenceRecord rows: 20.
- Physical report evidence/completion files: 17.
- DB-referenced files missing physically: 6.
- Unreferenced physical evidence files: 3.

Known affected missing-reference reports include:

1. Katsina Township Road Project, CLOSED, 2026-08-05.
2. Installation of Network Mast Uyo, Akwa Ibom State, CLOSED, 2026-08-06.

The three unreferenced physical files are older historical artifacts from different directories and timestamps.

Production and restored evidence trees were identical during the recovery rehearsal. Therefore the mismatch is not classified as backup corruption.

No production repair was performed.

## 5. Canonical UAT Protection

Canonical report:

```text
Gwagwalada Jurisdiction Routing UAT 2
```

Verified state:

- Status: CLOSED.
- Completion review state: CLOSED.
- Citizen completion decision: CONFIRMED.
- Organization completion decision: VERIFIED.
- Citizen rating: 5.
- Citizen evidence recovery: PASS.
- Provider completion evidence recovery: PASS.

The canonical Gwagwalada UAT record is not part of the historical mismatch set and remains unaffected and recoverable.

## 6. Tranche 1 Impact

Completed:

- Evidence-persistence failure-path hardening implemented in `71ac5ff`.
- Hardening deployed through Dokploy.
- Post-deployment API health verified.
- Persistent upload mount verified.
- Container/host file counts verified at `28/28`.
- Container/host storage sizes verified at approximately `2.6M/2.6M`.
- No evidence loss observed during redeployment.

Still open:

- Historical mismatch per-item export and classification.
- Mount monitoring.
- Backup and health alerting.
- Backup scheduling.
- Retention policy.
- Rollback rehearsal.
- Recurring restore cadence.

Tranche 1 is not fully complete.
