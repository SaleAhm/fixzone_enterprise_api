# Backup UI Completion and Truthfulness Audit

## Scope

Phase 7B-G reviewed backup/create/list/download/delete/restore parity between backend and Flutter Platform Tools.

## Backend capability

Backend endpoints exist for super admins:

| Capability | Endpoint | Backend status | Notes |
| --- | --- | --- | --- |
| Create backup | `POST /api/platform-tools/backups` | Implemented | Stabilized in Phase 7B-B with collision-resistant filenames |
| List backups | `GET /api/platform-tools/backups` | Implemented | Includes safe metadata read |
| Download backup | `GET /api/platform-tools/backups/:id/download` | Implemented | Streams JSON backup and audits download |
| Delete backup | `DELETE /api/platform-tools/backups/:id` | Implemented | Deletes file and metadata; audits action |
| Restore backup | `POST /api/platform-tools/backups/:id/restore` | Implemented but destructive | Deletes/recreates major tables in a transaction after `confirm=true` |

## Flutter UI capability

| Capability | Flutter status | Classification |
| --- | --- | --- |
| Create backup | Exposed | Partial working; manual browser evidence pending |
| List backups | Exposed | Partial working; manual browser evidence pending |
| Delete backup | Exposed with confirmation | Partial working; manual browser evidence pending |
| Download backup | Not exposed | Backend-only / governance-controlled |
| Restore backup | Not exposed | Deferred; governance-controlled |
| Export | Not part of backup panel | Deferred |

## Truthfulness defect found

The Platform Tools card text said:

```text
Create, list, download, restore, and delete database backups.
```

This was misleading because the visible Flutter UI does not expose download or restore.

## Fix applied

Flutter wording was updated to state:

```text
Create, list, and delete database backup metadata. Download and restore remain governance-controlled.
```

Backup panel helper text was also updated to:

```text
Download and restore remain governance-controlled and are not exposed in this release candidate.
```

No restore/download implementation was added.

## Restore governance

Restore must remain deferred until a future controlled tranche proves:

1. non-production environment isolation;
2. pre-restore backup creation;
3. explicit runbook and authorization;
4. rollback evidence;
5. audit trail review;
6. automated regression coverage;
7. destructive-action confirmation UX;
8. tenant/security review.

## Classification

`TRUTHFULNESS FIX IMPLEMENTED — BACKUP RESTORE/DOWNLOAD REMAIN DEFERRED`
