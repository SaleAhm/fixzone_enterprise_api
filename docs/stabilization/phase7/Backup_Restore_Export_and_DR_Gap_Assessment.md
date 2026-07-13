# Phase 7A — Backup, Restore, Export and Disaster-Recovery Gap Assessment

## Current Evidence

Backend schema and APIs include a `PlatformBackup` model and platform tools endpoints:

- `POST /api/platform-tools/backups`
- `GET /api/platform-tools/backups`
- `GET /api/platform-tools/backups/:id/download`
- `POST /api/platform-tools/backups/:id/restore`
- `DELETE /api/platform-tools/backups/:id`
- `GET /api/platform-tools/audit`
- `GET /api/platform-tools/audit/export`

Flutter Platform Tools UI supports backup listing, backup creation and deletion. Export is explicitly disabled in the current UI with the text: “Export is disabled for this release candidate.”

Prior operational evidence in Phase 2 documents shows:

- Production PostgreSQL backup artifact verified.
- Latest PostgreSQL backup restored into an isolated PostgreSQL 17 container.
- Daily/weekly backup scheduling verified.
- Redis, Docker volume, Dokploy configuration and environment backup artifacts verified.
- Off-site replication to the HPE ML30 disaster recovery target remains pending.

## Validation Finding

`npm test -- --runInBand` failed the Platform Tools e2e backup assertion:

- `test/platform-tools.e2e-spec.ts`
- Expected backup create status `201`
- Received `500`

This is a high-priority regression finding for Phase 7B.

## Capability Classification

| Capability | Current status | Evidence | Enterprise readiness |
|---|---|---|---|
| Create backup | API/UI present, test failing | Platform Tools endpoint/UI; e2e 500 | Not ready until regression fixed |
| List backups | API/UI present | Endpoint/UI | Partial |
| Download backup | Backend endpoint present | `GET /backups/:id/download` | Unsafe to expose without controls |
| Restore backup | Backend endpoint present | `POST /backups/:id/restore` | Unsafe to expose without controls |
| Delete backup | API/UI present | Endpoint/UI | Needs confirmation/audit verification |
| Backup status/size/location | Partial | PlatformBackup model/UI data | Needs operator-grade detail |
| Checksum verification | Not verified | No audit evidence found | Missing |
| Restore dry-run | Not verified | No UI evidence found | Missing |
| Restore history | Partial | `restoredAt/restoredById` fields exist | Needs UI/runbook |
| Backup failure alerts | Not verified | No alert flow identified | Missing |
| Retention controls | Documentation/ops only | Phase 2 docs | Needs UI/policy |
| Off-site copy status | Pending | HPE ML30 pending | Not complete |
| DR test evidence | DB restore verified only | Phase 2 evidence | Partial |
| Audit trail | Partial | DemoAuditLog/platform audit | Needs event-by-event proof |

## Safety Requirements Before Restore/Download Exposure

Restore functionality must require:

1. Explicit super-admin authorization.
2. Strong typed confirmation.
3. Mandatory pre-restore backup.
4. Tenant/system impact warning.
5. Role restriction and MFA/session recency if available.
6. Audit record with actor, timestamp, backup ID and reason.
7. Tested rollback plan.
8. Dry-run validation where possible.
9. Maintenance mode recommendation/automation.

Download functionality must require:

1. Super-admin-only access.
2. Short-lived signed URL or streamed response.
3. Audit log.
4. Secret/environment redaction policy.
5. Retention and off-site storage policy.

## Export Findings

| Export type | Status | Gap |
|---|---|---|
| Audit log export | Backend endpoint exists; UI disabled | Build UI with filters, pagination and secure download |
| Report export | Not complete | Add date/status/org filters and tenant scoping |
| Organization export | Missing | Add super-admin/org-admin variants |
| Provider export | Missing | Include capabilities and performance scope |
| User export | Missing | Redact sensitive fields |
| Billing export/invoice download | Partial/missing | Payment/invoice tranche required |
| Evidence download | Sensitive; not mature | Role-restricted signed access and audit required |
| Investor report | Public analytics exist | Add curated downloadable report later |

## Recommendation

Phase 7D should implement operational backup, restore, export and DR tooling after Phase 7B regression stabilization. Do not expose restore/download controls in production until safety, audit and rollback controls are complete.

