# FixZone Backup and Recovery Contract

Date: 2026-08-22

Scope: Phase 8 Tranche 1 contract for recovery-set identity, database backup, upload backup, consistency, manifests, verification, and classification.

This document defines the expected operational contract only. It does not run backup commands, restore commands, migrations, or production checks.

## 1. Canonical Recovery Set

A FixZone recovery set is the minimum coordinated package required to restore the application data plane.

One recovery set must bind together, under one timestamp and recovery identifier:

- PostgreSQL database backup.
- Uploads and evidence archive.
- Checksums.
- Manifest and metadata.
- Application/repository version metadata where practical.

Conceptual layout:

```text
fixzone-recovery-YYYY-MM-DD_HH-MM-SS/
  database/
    fixzone.dump
  uploads/
    uploads.tar.gz
  manifests/
    checksums.sha256
    recovery-manifest.txt
```

Existing operational naming conventions may be used if they preserve the same requirement: database and uploads from the same operation must be identifiable as one coordinated recovery set.

Database and evidence must be restored together because report evidence and completion evidence are split between database references and filesystem files. Restoring only one side can create missing images, orphan files, incorrect evidence counts, or broken governance review records.

## 2. Database Backup Contract

Expected V1 database backup behavior:

- Source: production PostgreSQL database for the FixZone backend.
- Format: PostgreSQL custom-format dump where practical.
- Tooling: `pg_dump` for capture, `pg_restore --list` or equivalent for readability verification.
- Timestamp: recovery-set timestamp in UTC or explicitly identified local time.
- Filename: stable name inside the recovery set, such as `fixzone.dump`, or an approved existing convention.
- Credentials: never written into the manifest, checksum file, docs, screenshots, or ticket comments.
- Connection requirements: use approved operator environment or secret store; record only non-secret labels such as environment and database role category.
- Checksum: generate and preserve a checksum for the dump artifact.
- Verification: dump exists, non-zero size, readable by restore-list command, checksum generated.

Failure criteria:

- Dump command fails.
- Dump file is missing or zero bytes.
- Restore-list verification fails.
- Checksum generation fails.
- Recovery-set ID does not match the manifest.
- Secret material is captured in the manifest or logs.

## 3. Upload / Evidence Backup Contract

Canonical production dependency:

- Host: `/srv/securezone-data/fixzone/uploads`
- Container: `/app/uploads`
- `UPLOAD_ROOT`: `/app/uploads`

Backup coverage:

- `report-evidence/`
- `report-completion/`
- Any other legitimate FixZone upload paths under `UPLOAD_ROOT`

Archive expectations:

- Capture the entire approved upload root, preserving relative paths.
- Preserve enough ownership and permission context for restore planning.
- Record archive size.
- Record file count.
- Verify archive listing.
- Generate checksum.
- Do not archive unrelated server paths.
- Do not expose files through unrestricted static hosting.

Failure criteria:

- Upload root is missing.
- Archive command fails.
- Archive is missing or zero bytes.
- Archive listing fails.
- Expected top-level evidence paths are missing without explanation.
- File count cannot be recorded.
- Checksum generation fails.
- Archive path points outside the approved upload root.

## 4. Consistency Contract

Current V1 limitation: the database and uploads backup are not proven atomic.

Practical V1 consistency approach:

1. Start recovery operation.
2. Record timestamp and recovery set ID.
3. Capture database dump.
4. Capture uploads archive immediately around the same recovery window.
5. Record start and end times.
6. Verify both artifacts.
7. Build one manifest.
8. Treat database dump and uploads archive as an inseparable recovery pair.

Acceptable V1 risk:

- A short window may exist where database references and uploaded files can drift.
- Controlled maintenance or reduced-write windows reduce but do not eliminate this risk.
- Recovery proof depends on isolated restore and evidence consistency checks.

Do not claim point-in-time consistency unless a true atomic snapshot or database/filesystem coordination mechanism is implemented and verified.

## 5. Backup Manifest Definition

The manifest must be non-secret.

Required fields:

```text
Recovery Set ID:
Creation Start:
Creation End:
Environment:
Database Backup Filename:
Database Backup Size:
Database Dump Format:
Uploads Archive Filename:
Uploads Archive Size:
Uploads File Count:
Checksum Filename:
Backend Git Commit:
Frontend Git Commit:
UPLOAD_ROOT:
Persistent Host Path:
Verification Status:
Verification Timestamp:
Operator Role:
Notes:
```

Allowed values for verification status:

- `VALID`
- `INVALID`
- `UNVERIFIED`

Do not include:

- Passwords.
- Tokens.
- Private keys.
- Database URLs with credentials.
- Provider secrets.
- Session values.
- Personal credentials.

## 6. Backup Verification Checklist

A recovery set is not usable until these checks are complete.

Database PASS checks:

- Dump file exists.
- Dump file has non-zero size.
- Restore-list verification succeeds.
- Checksum is generated.
- Database filename matches the manifest.

Uploads PASS checks:

- Archive exists.
- Archive has non-zero size.
- Archive listing succeeds.
- Expected top-level upload paths are present or absence is explained.
- File count is recorded.
- Archive checksum is generated.
- Archive filename matches the manifest.

Pair PASS checks:

- Database and uploads share the same recovery set ID.
- Manifest is complete.
- No backup or verification command failed.
- Verification timestamp is recorded.
- Operator role is recorded.
- No secret values are present.

Classification:

- `VALID`: all mandatory checks pass.
- `INVALID`: one or more mandatory checks fail.
- `UNVERIFIED`: artifacts exist but mandatory checks have not been completed.

## 7. Recovery Use Rules

- Use only `VALID` recovery sets for rehearsal.
- Do not use `UNVERIFIED` recovery sets except for investigation.
- Do not use `INVALID` recovery sets for restore.
- Do not split database and uploads across different recovery set IDs unless a formal incident exception is approved and documented.
- Do not restore production without explicit emergency recovery authorization.
