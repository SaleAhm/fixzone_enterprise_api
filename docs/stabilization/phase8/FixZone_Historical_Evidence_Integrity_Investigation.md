# FixZone Historical Evidence Integrity Investigation

Date: 2026-08-22

Scope: Phase 8 Tranche 1 read-only investigation and documentation for historical evidence database/file mismatches discovered during the verified V1 recovery rehearsal.

This document does not authorize or perform production repair, rehearsal repair, evidence deletion, file copy, file rename, migration, deployment, cleanup, backup creation, or restore execution.

## 1. Purpose

The purpose of this investigation is to document the known historical evidence-integrity mismatch and assess whether it appears to be a backup failure, a historical data artifact, or an active V1 application risk.

Known mismatch:

- Six EvidenceRecord rows reference files that do not resolve to current physical files.
- Three physical evidence files have no matching EvidenceRecord row.

## 2. Known Recovery Baseline

Recovery set:

```text
fixzone-v1-baseline-2026-08-22_15-53-38
```

Recovery rehearsal:

```text
PASS
```

Isolated database:

```text
fixzone_restore_rehearsal_20260822
```

Isolated uploads:

```text
/tmp/fixzone_restore_rehearsal_20260822/uploads
```

Production uploads:

```text
/srv/securezone-data/fixzone/uploads
```

Verified during rehearsal:

- Production/restored evidence trees were identical.
- Database restore counts reproduced exactly.
- Gwagwalada Jurisdiction Routing UAT 2 was fully recoverable.
- The mismatch predates backup/recovery.

## 3. Why This Is Not A Backup Failure

The mismatch is not classified as a backup failure because:

- Production and restored physical evidence trees were identical.
- Production file count, archived file count, and restored file count were all 28.
- Key restored database counts matched production counts exactly.
- The canonical Gwagwalada UAT report restored with citizen and provider evidence present.
- The missing-file and unreferenced-file mismatch was already present in the captured production state.

Classification:

```text
PRE-EXISTING HISTORICAL DATA-INTEGRITY FINDING
```

## 4. Investigation Access Limitation

This documentation task ran from the Windows repository workspace.

The Linux rehearsal and upload paths were not mounted into this workspace:

- `/tmp/fixzone_restore_rehearsal_20260822/uploads`
- `/srv/securezone-data/fixzone/uploads`
- `/srv/securezone-backups/manual/fixzone-v1-baseline-2026-08-22_15-53-38`

Docker was not available from this workspace, and a local PostgreSQL probe for the isolated database did not return a usable read-only result without hanging for connection/authentication.

Therefore this document does not invent EvidenceRecord IDs, report IDs, uploader IDs, timestamps, or filenames for the nine mismatch items. Per-item metadata remains pending from the already-restored environment or from an approved exported read-only mismatch report.

## 5. Six Missing DB-Reference Cases

Known aggregate:

- EvidenceRecord rows: 20.
- DB-referenced files with no matching physical file: 6.

Per-item metadata available in this workspace: not available.

| Case | Classification | Evidence available now | Required follow-up |
| --- | --- | --- | --- |
| Missing DB reference 1 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export EvidenceRecord id, report id, report title, uploadedAt, fileUrl, metadata, and activity context |
| Missing DB reference 2 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export EvidenceRecord id, report id, report title, uploadedAt, fileUrl, metadata, and activity context |
| Missing DB reference 3 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export EvidenceRecord id, report id, report title, uploadedAt, fileUrl, metadata, and activity context |
| Missing DB reference 4 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export EvidenceRecord id, report id, report title, uploadedAt, fileUrl, metadata, and activity context |
| Missing DB reference 5 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export EvidenceRecord id, report id, report title, uploadedAt, fileUrl, metadata, and activity context |
| Missing DB reference 6 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export EvidenceRecord id, report id, report title, uploadedAt, fileUrl, metadata, and activity context |

Current conclusion:

- These six cases are historical integrity gaps until per-row context proves a narrower cause.
- They are not backup corruption.
- They should not be repaired without a governed future plan.

## 6. Three Unreferenced-File Cases

Known aggregate:

- Physical evidence files under `report-evidence` and `report-completion`: 17.
- Physical evidence files with no matching EvidenceRecord: 3.

Per-item metadata available in this workspace: not available.

| Case | Classification | Evidence available now | Required follow-up |
| --- | --- | --- | --- |
| Unreferenced physical file 1 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export path, report directory id, file size, modification timestamp, and possible report/activity match |
| Unreferenced physical file 2 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export path, report directory id, file size, modification timestamp, and possible report/activity match |
| Unreferenced physical file 3 | UNRESOLVED INTEGRITY GAP | Aggregate count only | Export path, report directory id, file size, modification timestamp, and possible report/activity match |

Current conclusion:

- These three cases could be historical orphan files, old legacy report-path files, or failed post-file-write persistence residues.
- Source code supports a plausible current failure mode for unreferenced files if a file write succeeds and the later EvidenceRecord insert fails.
- The aggregate evidence does not prove that this happened for the three historical files.

## 7. Source-Code Pathways Inspected

Inspected source and schema:

- `src/security/upload-security.service.ts`
- `src/report/report.service.ts`
- `src/report/report.controller.ts`
- `src/storage/upload-root.ts`
- `src/demo-data/demo-data.service.ts`
- `src/platform-tools/platform-tools.service.ts`
- `prisma/schema.prisma`
- Relevant report workflow tests.

Findings:

- Current report evidence upload route is `POST /api/report/:id/evidence`.
- Current provider completion evidence upload route is `POST /api/report/:id/completion-evidence`.
- UploadSecurityService validates the image, creates the target directory, writes the file, then returns a relative `imagePath` and `/uploads/...` URL.
- ReportService then creates the EvidenceRecord after the file save returns.
- The file write and EvidenceRecord creation are sequential, not transactionally atomic across filesystem and database.
- Evidence retrieval checks authorization, confirms the report references the expected path, asserts path safety under the upload root, and requires the physical file to exist.
- Current report service search did not find production evidence cleanup/purge logic that deletes report evidence files.
- Demo purge is blocked in production mode and deletes tagged demo database rows, not runtime evidence files.
- Platform Tools backup deletion and temporary cache clearing do not target report evidence paths.
- Report workflow tests contain test-only cleanup code for temporary upload artifacts.

## 8. Current V1 Divergence Risk Assessment

### Missing physical file for DB row

Current V1 upload flow writes the physical file before creating the EvidenceRecord.

Source-backed assessment:

- A current successful EvidenceRecord insert should normally imply the preceding file save returned successfully.
- Current source does not show report evidence cleanup code that would later delete the file.
- Current source does not prove an active V1 path that creates DB rows before file persistence.

Classification:

```text
LIKELY HISTORICAL ARTIFACT until per-row metadata proves otherwise
```

### Physical file without EvidenceRecord

Current V1 upload flow can write a file and then fail before or during EvidenceRecord creation.

Source-backed assessment:

- File write and DB insert are not atomic.
- A crash, process kill, database failure, or exception after file write and before EvidenceRecord insertion could leave an orphan physical file.
- This is a possible current V1 divergence mode.

Classification:

```text
ACTIVE V1 RISK
```

Risk severity:

- Limited integrity risk for orphan files.
- Does not directly create missing user-visible evidence if no DB/report reference points to the file.
- Still worth hardening because evidence storage should be reconciled and auditable.

## 9. Cleanup / Purge Risk Assessment

Current source-backed findings:

- No production report evidence file purge path was found in ReportService.
- Demo purge is blocked in production mode and does not show runtime upload-file deletion.
- Platform Tools temporary cache clearing targets temporary folders, not `report-evidence` or `report-completion`.
- Platform Tools backup deletion removes metadata backup files, not runtime evidence.
- Test cleanup deletes upload directories for test-created reports only.

Conclusion:

- No current production cleanup/purge path was found that explains the six missing physical files.
- Historical manual cleanup, old test/UAT cleanup, legacy code, or environment-level file loss remain hypotheses until per-item metadata is inspected.

## 10. Canonical Gwagwalada UAT Protection Result

Canonical report:

```text
Gwagwalada Jurisdiction Routing UAT 2
```

Status:

- Not identified as part of the mismatch set in the verified recovery evidence.
- Citizen report evidence is consistent and recoverable.
- Provider completion evidence is consistent and recoverable.
- The canonical V1 production UAT closure evidence remains protected and recoverable.

## 11. Root-Cause Conclusions Where Proven

Proven:

- The mismatch is historical and predates backup/recovery.
- The recovery process did not omit the missing files.
- Current V1 upload writes are sequential across filesystem and database.
- Current V1 has a plausible orphan-file risk if file persistence succeeds and later DB persistence fails.
- Current source does not show a production report-evidence cleanup path that would explain missing physical files.

Not proven:

- The exact report titles or IDs for the six missing DB references.
- The exact paths, timestamps, or report directories for the three unreferenced files.
- Whether any individual mismatch item is a UAT/test artifact, rework residue, failed upload, manual cleanup result, legacy URL artifact, or old implementation residue.

## 12. Hypotheses Where Not Proven

Possible causes for the six DB-referenced missing files:

- Legacy evidence rows from older path semantics.
- Evidence files deleted by historical manual cleanup or environment replacement before persistent mount stabilization.
- Old UAT/test artifacts.
- Superseded evidence from earlier implementation stages.
- Historical code path that stored DB reference without durable file persistence.

Possible causes for the three unreferenced physical files:

- File write succeeded but EvidenceRecord creation failed.
- Legacy report field references exist outside EvidenceRecord.
- Superseded upload retained physically.
- Historical test/UAT artifact.
- Previous partial upload or interrupted request.

These remain hypotheses only.

## 13. Production Repair Recommendation

Production repair is not recommended in this task.

Future repair may be considered only after:

- A read-only mismatch export identifies all nine items.
- Each item is classified by report, status, workflow relevance, and user visibility.
- Canonical V1 production UAT records are confirmed unaffected.
- A backup is verified before remediation.
- A reversible repair plan is approved.
- Repair actions are audited.

Potential governed future repair plan:

1. Generate a read-only mismatch report from restored or production data.
2. Review each mismatch with report/activity context.
3. Classify each item as historical artifact, orphan file, active record, or user-visible risk.
4. For missing files, decide whether to preserve the DB row as historical metadata, mark it unavailable, or attach an explicit remediation note.
5. For orphan files, decide whether to link to legacy report fields, archive, or leave untouched.
6. Execute no mutation until a separate approved repair checkpoint exists.

## 14. Application Hardening Recommendation

Implemented hardening in the evidence persistence tranche:

Implementation commit:

```text
71ac5ff fix: clean unpersisted evidence uploads on persistence failure
```

Production verification record:

```text
PASS
```

- Current citizen report evidence and provider completion evidence uploads now track files created by the active request until their corresponding EvidenceRecord row is persisted.
- If EvidenceRecord persistence fails after a file write, the service attempts compensating deletion of only the newly created, unpersisted file.
- Cleanup uses upload-root path validation and single-file deletion only.
- Cleanup failure is logged and does not replace the original persistence exception.
- Files that already have persisted EvidenceRecord rows are not removed by this compensating cleanup.
- Pre-existing evidence is not targeted.
- The successful deployment of commit `71ac5ff` was recorded after `f3468bf..71ac5ff main -> main`, followed by Dokploy status `Done`.
- Post-deployment API health, `UPLOAD_ROOT`, persistent bind mount, container/host upload counts, and container/host storage size were recorded as passing.
- No evidence loss was observed during the redeployment.

Recommended remaining hardening, separate from this documentation task:

- Add a read-only evidence consistency report for DB/file reconciliation.
- Consider a post-upload consistency assertion that verifies file existence after DB insert.
- Record checksum or size metadata when creating EvidenceRecord rows.
- Add operational alerting if evidence mismatch count increases.
- Keep destructive cleanup out of automatic runtime paths unless governed and audited.

Historical mismatch status:

- The six missing DB-referenced files remain unrepaired.
- The three unreferenced physical files remain unrepaired.
- No historical root cause is proven by this hardening.
- Gwagwalada Jurisdiction Routing UAT 2 remains unaffected and recoverable.
- The hardening reduces the current orphan-file failure path but does not make filesystem and database writes fully atomic.
- A residual crash/process-kill window remains if the process terminates after file write and before compensating cleanup can run.

## 15. Tranche 1 Readiness Impact

Recovery rehearsal remains:

```text
PASS
```

Data integrity remains:

```text
PASS WITH HISTORICAL FINDING / INVESTIGATION REQUIRED
```

The historical mismatch does not invalidate the verified recovery set or the canonical Gwagwalada UAT recovery proof.

Pilot readiness remains conditional until:

- The nine mismatch items are exported and classified.
- Current upload-flow orphan-file hardening is accepted with the documented residual crash/process-kill limitation.
- Backup schedule, retention, alerting, mount monitoring, recurring restore cadence, and rollback rehearsal are completed.

## 16. Rehearsal Resources

Resources still pending separately approved cleanup:

- Database: `fixzone_restore_rehearsal_20260822`
- Temporary uploads: `/tmp/fixzone_restore_rehearsal_20260822`

No cleanup was performed by this task.
