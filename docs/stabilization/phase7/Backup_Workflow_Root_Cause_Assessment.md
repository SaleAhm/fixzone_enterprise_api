# Backup Workflow Root Cause Assessment

Date: 2026-07-16

## Endpoint

`POST /api/platform-tools/backups`

## Required access

`SUPER_ADMIN` authenticated with JWT.

## Historical failure

Phase 7A observed HTTP 500 during backup creation.

## Confirmed current defect

The backup filename used only a second-level timestamp:

`fixzone-backup-YYYYMMDDHHMMSS.json`

Two backup requests in the same second could generate the same filename and then collide with the unique `PlatformBackup.fileName` database constraint. This also risked file overwrite before metadata creation.

## Classification

- A: Production runtime defect
- G: Non-idempotent workflow
- K: Concurrent/rapid-operation race

## Fix

Backup filenames now include an eight-character operation suffix:

`fixzone-backup-YYYYMMDDHHMMSS-xxxxxxxx.json`

The suffix is derived from `randomUUID()`.

## Regression coverage

Added test:

`creates repeated backups without filename collisions`

The test creates two backups sequentially and verifies both succeed with distinct filenames and paths.

## Remaining limitations

The backup workflow still writes a JSON file before inserting metadata. Future hardening may add a temporary file + atomic rename lifecycle and explicit rollback after metadata persistence failures.

