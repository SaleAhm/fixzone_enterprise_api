# FixZone Isolated Restore Rehearsal Procedure

Date: 2026-08-22

Scope: future manual rehearsal procedure for restoring a verified FixZone recovery set into an isolated, non-production target.

This document is procedural design only. No restore is executed by this document.

## 1. Hard Safety Rules

- Never target production during rehearsal.
- Never write to the production database.
- Never extract uploads into the production upload directory.
- Never use production environment variables directly in a temporary app.
- Never run migrations against production as part of rehearsal.
- Never tear down rehearsal evidence before explicit approval.
- Clearly label all shell snippets as future manual commands.

## 2. Rehearsal Preconditions

Before rehearsal:

- One recovery set is classified `VALID`.
- Restore Approver confirms rehearsal scope.
- Backup Operator provides database dump, uploads archive, checksums, and manifest.
- Isolated PostgreSQL target is available.
- Isolated upload directory is available.
- Temporary non-production app environment is available if application smoke checks are included.
- No production credentials are copied into notes or docs.

## 3. Future Manual Stages

### A. Select One Verified Recovery Set

Confirm:

- Recovery Set ID.
- Database artifact.
- Upload artifact.
- Checksums.
- Manifest.
- Backend and frontend commit metadata if available.

### B. Provision Isolated PostgreSQL Target

Use a disposable database or container. It must not be production.

Future manual command example:

```bash
# FUTURE MANUAL COMMAND - DO NOT RUN DURING DOCUMENTATION TASKS
# Create an isolated PostgreSQL target using approved local or staging infrastructure.
```

### C. Restore Database

Restore the selected dump into the isolated target only.

Future manual command example:

```bash
# FUTURE MANUAL COMMAND - DO NOT RUN DURING DOCUMENTATION TASKS
# pg_restore --clean --if-exists --dbname "<isolated-database>" database/fixzone.dump
```

Record:

- Start time.
- End time.
- Exit status.
- Restore warnings.
- Restored database name.

### D. Restore Uploads

Extract uploads into an isolated directory only.

Future manual command example:

```bash
# FUTURE MANUAL COMMAND - DO NOT RUN DURING DOCUMENTATION TASKS
# mkdir -p /tmp/fixzone-restore/uploads
# tar -xzf uploads/uploads.tar.gz -C /tmp/fixzone-restore
```

Record:

- Extracted root path.
- File count.
- Archive listing status.
- Storage size.

### E. Verify Row / Model Counts

Collect read-only counts from important restored models:

- Users.
- Organizations.
- Reports.
- Evidence records, if present.
- Notifications.
- Report activities.
- Completion governance records, if represented by report/activity data.

Counts are evidence, not mutation.

### F. Verify EvidenceRecord / File Consistency

Check for:

- Database evidence records pointing to missing files.
- Report legacy evidence paths pointing to missing files.
- Completion evidence paths pointing to missing files.
- Files outside the restored upload root.
- Duplicate unexpected paths.
- Orphan files with no corresponding database reference.

### G. Verify Selected Report Evidence Paths

Use representative report IDs from the manifest or restored database:

- Citizen report evidence.
- Provider completion evidence.
- Closed report evidence.
- Reports with no evidence, to confirm empty states remain valid.

### H. Verify Closed UAT Report Metadata If Present

If the selected backup contains the known closed production UAT report, verify:

- Status remains CLOSED.
- Responsibility routing fields are present.
- Completion evidence references are present.
- Citizen rating/feedback fields are intact where applicable.
- Organization completion review fields are intact where applicable.

Do not modify the UAT record.

### I. Verify Application Compatibility

If a temporary app instance is used:

- Point `DATABASE_URL` to the isolated database.
- Point `UPLOAD_ROOT` to the isolated upload directory.
- Start the app in non-production mode.
- Verify API health.
- Verify protected evidence route behavior using approved non-production auth context.

Do not point the temporary app to production.

### J. Document PASS / FAIL

Record:

- Recovery Set ID.
- Rehearsal start/end time.
- Operator roles.
- Database restore result.
- Upload restore result.
- Evidence consistency result.
- App compatibility result.
- Known deviations.
- Final result: PASS or FAIL.

### K. Tear Down After Approval

Only after the Restore Approver confirms evidence capture:

- Destroy isolated database.
- Remove isolated upload directory.
- Remove temporary app container/config.
- Preserve rehearsal notes and logs in the approved evidence location.

## 4. Evidence Consistency Verification Design

The future verification procedure should be read-only.

It should identify:

- Evidence records pointing to missing files.
- Legacy report evidence fields pointing to missing files.
- Completion evidence fields pointing to missing files.
- Orphan files with no database reference.
- Paths outside `UPLOAD_ROOT`.
- Duplicate unexpected paths.
- Report evidence and completion evidence mismatches.

Recommended future implementation:

- Build a read-only verification script in a later approved checkpoint.
- Accept isolated `DATABASE_URL` and isolated `UPLOAD_ROOT`.
- Refuse to run when environment appears to be production unless explicitly allowed for a read-only audit.
- Produce a summary report without deleting or rewriting anything.

## 5. Rehearsal Pass Criteria

The rehearsal passes only if:

- Database restore completes.
- Upload extraction completes.
- Checksums match.
- Required model counts are collected.
- Evidence consistency has no unexplained critical mismatch.
- Application compatibility check passes if included.
- No production system was touched.
- Evidence is captured and approved.

## 6. Rehearsal Fail Criteria

The rehearsal fails if:

- Any artifact is missing.
- Checksum verification fails.
- Database restore fails.
- Upload archive extraction fails.
- Evidence consistency reports critical missing files.
- Temporary app cannot start against restored data.
- Production target is accidentally referenced.
- Secret values appear in logs or notes.
