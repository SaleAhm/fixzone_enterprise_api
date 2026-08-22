# FixZone V1 Recovery Rehearsal Evidence

Date: 2026-08-22

Scope: Phase 8 Tranche 1 evidence record for the manually verified FixZone V1 recovery set and isolated restore rehearsal.

This document records evidence from an already completed manual verification. It does not authorize or perform production access, production repair, backup creation, restore execution, cleanup, migration, deployment, or data mutation.

## 1. Purpose

The purpose of this document is to record whether a coordinated FixZone V1 recovery set can restore the stabilized production baseline into an isolated environment, including both PostgreSQL data and uploaded evidence files.

It also records a historical database/file integrity finding discovered during reconciliation. That finding is classified separately from the recovery rehearsal result.

## 2. Recovery Set Identity

Recovery Set ID:

```text
fixzone-v1-baseline-2026-08-22_15-53-38
```

Location used during manual verification:

```text
/srv/securezone-backups/manual/fixzone-v1-baseline-2026-08-22_15-53-38
```

Recorded baseline:

- Backend: `5f0db9b`
- Frontend: `9378331`

## 3. Recovery Set Contents

The recovery set contained:

- `fixzone-postgres.dump`
- `fixzone-uploads.tar.gz`
- `checksums.sha256`
- `database-toc.txt`
- `uploads-list.txt`
- `recovery-manifest.txt`

These artifacts satisfy the coordinated recovery-set requirement for database, uploads, checksums, structural listings, and manifest metadata.

## 4. Checksum Verification

Checksum verification result:

- `fixzone-postgres.dump`: OK
- `fixzone-uploads.tar.gz`: OK

Verdict: PASS.

## 5. Database Structural Verification

Database backup:

- Format: PostgreSQL custom format.
- Size: 232827 bytes.
- TOC entries: 364.
- Structural listing: PASS.

The structural listing confirms the dump is readable as a PostgreSQL restore artifact. It does not by itself prove application-level recovery; that proof comes from isolated restore and count verification.

## 6. Upload Structural Verification

Uploads backup:

- Live production upload files at backup time: 28.
- Archived upload files: 28.
- Archive size: 2470905 bytes.
- Archive structural listing: PASS.

Verdict: PASS.

## 7. Isolated Restore Architecture

Restore environment:

```text
securezone-restore-check
```

PostgreSQL version:

```text
17
```

Isolated database:

```text
fixzone_restore_rehearsal_20260822
```

Temporary upload restore root:

```text
/tmp/fixzone_restore_rehearsal_20260822
```

Production database was not used as the restore target.

Production uploads were not used as the upload restore target.

## 8. Production-Safety Controls

Safety controls recorded:

- No production database restore target was used.
- No production upload restore target was used.
- Production API remained healthy during and after the rehearsal.
- No production data repair was performed.
- No EvidenceRecord rows were modified.
- No evidence files were deleted.
- No cleanup was performed in this documentation task.

## 9. Database Restore Result

The isolated database restore completed successfully.

Important restored tables confirmed:

- `EvidenceRecord`
- `Notification`
- `Report`
- `ReportActivity`

Verdict: PASS.

## 10. Exact Restored Counts

Pre-backup production counts:

| Model | Count |
| --- | ---: |
| Reports | 114 |
| EvidenceRecord | 20 |
| ReportActivity | 184 |

Isolated restored counts:

| Model | Count |
| --- | ---: |
| Reports | 114 |
| EvidenceRecord | 20 |
| ReportActivity | 184 |

Exact count reproduction: PASS.

## 11. Upload Restore Result

The upload archive restored successfully into the isolated temporary upload root.

Restored files: 28.

Restored size: approximately 2.6 MB.

Verdict: PASS.

## 12. Production / Restored Tree Comparison

Counts:

- Production files: 28.
- Archived files: 28.
- Restored files: 28.

The production and restored evidence trees were compared.

Result: PASS. The production and restored evidence trees are identical.

## 13. Gwagwalada UAT Recovery Proof

Canonical production UAT report:

```text
Gwagwalada Jurisdiction Routing UAT 2
```

Restored state:

| Field | Restored value |
| --- | --- |
| status | CLOSED |
| completionReviewState | CLOSED |
| citizenCompletionDecision | CONFIRMED |
| organizationCompletionDecision | VERIFIED |
| citizenRating | 5 |

Citizen report evidence:

- Database record restored.
- Physical restored file present.
- Production physical file present.
- Verdict: PASS.

Provider completion evidence:

- Database record restored.
- Physical restored file present.
- Production physical file present.
- Verdict: PASS.

Conclusion: the canonical FixZone V1 production UAT closure evidence is recoverable from the verified recovery set.

## 14. Historical Evidence-Integrity Finding

During database-to-file reconciliation:

- EvidenceRecord rows: 20.
- Physical files under `report-evidence` and `report-completion`: 17.
- DB-referenced files with no matching physical file: 6.
- Physical evidence files with no matching EvidenceRecord: 3.

The production physical evidence tree and restored physical evidence tree are identical.

Therefore the recovery process did not omit the six referenced files.

## 15. Why Finding Is Not A Backup Failure

The mismatch is not classified as backup corruption because:

- Database counts restored exactly.
- Upload file counts restored exactly.
- Production and restored upload trees are identical.
- The canonical Gwagwalada UAT report evidence restored successfully.
- The mismatch existed in the production state captured by the recovery set.

Classification:

```text
PRE-EXISTING HISTORICAL DATA-INTEGRITY FINDING
```

Potential causes remain hypotheses only:

- Historical UAT or test artifacts.
- Superseded uploads.
- Failed or partial historical upload workflows.
- Evidence cleanup without corresponding record cleanup.
- Old evidence URL semantics.
- Legacy records from earlier implementation stages.

No root cause is asserted by this document.

## 16. What Remains Unresolved

Open questions:

- Which six DB-referenced paths no longer have matching physical files.
- Which three physical files are not referenced by EvidenceRecord rows.
- Whether any legacy report fields explain the three unreferenced files.
- Whether mismatches are limited to old UAT/test artifacts.
- Whether old upload flows created rows before file persistence completed.
- Whether any user-visible workflow is affected beyond historical records.

No repair was performed.

## 17. Recommended Future Integrity Investigation

Recommended next investigation:

- Build or run an approved read-only evidence consistency report.
- Use non-production restored data first where practical.
- Classify each mismatch by report, status, date, path type, and visibility.
- Distinguish active production reports from historical UAT/test records.
- Check both EvidenceRecord rows and legacy report evidence fields.
- Do not delete files or repair rows until a separate remediation plan is approved.
- If repair is later approved, create a pre-repair backup and a reversible audit trail.

## 18. Production Repair Statement

No production repair was performed.

No EvidenceRecord rows were changed.

No evidence files were deleted, moved, or rewritten.

No production data mutation was performed by this documentation task.

## 19. Recovery Rehearsal Verdict

Recovery rehearsal:

```text
PASS
```

The verified recovery set restored database structure, exact key table counts, uploads, upload file counts, evidence tree equality, and the canonical Gwagwalada UAT closure evidence into isolated rehearsal targets.

Data-integrity classification:

```text
PASS WITH HISTORICAL FINDING / INVESTIGATION REQUIRED
```

The data-integrity finding does not make the recovery rehearsal fail.

## 20. Tranche 1 Readiness Impact

Items now completed:

- Verified coordinated post-V1 recovery set.
- Checksum verification.
- PostgreSQL isolated restore rehearsal.
- Uploads isolated restore rehearsal.
- Exact database count reproduction.
- Production/restored evidence-tree equality.
- Canonical Gwagwalada UAT recovery proof.

Items still open:

- Historical EvidenceRecord/file mismatch investigation.
- Backup scheduling.
- Retention.
- Alerting.
- Recurring restore cadence.
- Rollback rehearsal.
- Mount monitoring.

Temporary rehearsal resources pending separately approved cleanup:

- Database: `fixzone_restore_rehearsal_20260822`
- Temporary uploads: `/tmp/fixzone_restore_rehearsal_20260822`
