# Phase 7C-A Provider Assignment Expiry and Reassignment Report

## Scope

This report records the Phase 7C-A review of assignment acceptance, rejection, expiry, and reassignment behavior.

## Backend behavior inspected

The current backend exposes and preserves:

- `PATCH /api/report/:id/status` for provider status transitions.
- `POST /api/report/provider/:id/reject` and `POST /api/report/:id/reject-assignment`.
- `PATCH /api/report/:id/assign`.
- `PATCH /api/report/:id/reassign`.
- `POST /api/report/admin/assignments/expire-overdue`.

## Existing guard behavior

| Case | Behavior | Classification |
| --- | --- | --- |
| Provider accepts own valid assignment | Allowed through canonical status transition | VERIFIED |
| Provider accepts another provider's assignment | Rejected by ownership guard | VERIFIED |
| Provider accepts expired assignment | Rejected with `Assignment acceptance window expired` | VERIFIED |
| Expired assignment attempted from stale state | Report returns to queue, provider claim cleared | VERIFIED |
| Provider rejects assigned job | Report returns to `PENDING`, reason/outcome retained | VERIFIED |
| Dispatch reassigns after rejection | New provider receives active assignment | VERIFIED |
| Reassignment supersedes old provider | Old provider cannot accept after reassignment | VERIFIED |
| Reassignment after closure | Guarded by status rules | VERIFIED |

## Test evidence

Existing `test/report-workflow.e2e-spec.ts` includes focused coverage for:

- assigned providers rejecting jobs back to dispatch;
- overdue offers expiring when acceptance is attempted after deadline;
- superseded providers being blocked after reassignment;
- non-provider and cross-organization assignment protections;
- invalid status transitions.

## Phase 7C-A changes

No backend change was required. No schema change, migration, data seed, or production operation was performed.

## Manual evidence status

Manual authenticated browser retest of accept/reject/expiry/reassignment remains `NOT TESTED` in this tranche.
