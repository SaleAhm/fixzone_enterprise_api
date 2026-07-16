# Provider Assignment Timer and Reassignment Assessment

Date: 2026-07-16

## Backend endpoints assessed

- `PATCH /api/report/:id/assign`
- `PATCH /api/report/:id/reassign`
- `POST /api/report/admin/assignments/expire-overdue`
- `PATCH /api/report/:id/status`
- `POST /api/report/provider/:id/reject`
- `PATCH /api/report/:id/reject-assignment`

## Confirmed defect

Provider acceptance through `PATCH /api/report/:id/status` did not check whether the assignment deadline had expired before moving from `ASSIGNED` to `IN_PROGRESS`.

## Implemented behavior

When an assigned provider attempts to accept after expiry:

1. the existing overdue assignment expiry workflow runs for that provider;
2. report status returns to `PENDING`;
3. active assignment fields are cleared;
4. `lastAssignmentOutcome` is set to `TIMED_OUT`;
5. timeout notifications/audit/timeline behavior is preserved;
6. the provider receives HTTP `409`.

## Reassignment behavior

Focused e2e confirms:

- after reassignment, the old provider receives `403 Not your report`;
- the currently assigned provider can accept and move the report to `IN_PROGRESS`.

## Files changed

- `src/report/report.service.ts`
- `test/report-workflow.e2e-spec.ts`

## Remaining provider workflow backlog

- Flutter should hide/disable stale provider action buttons after offer expiry.
- Repeated reassignment UX should be verified interactively.
- Notification click-through should be verified in Flutter.

