# Backend Failure Root Cause Matrix

Date: 2026-07-16

## Classification key

- A: Runtime defect
- B: Fixture collision
- C: Database contamination
- D: Rate-limit contamination
- E: Mock leakage
- F: Environment mismatch
- G: Stale test expectation
- H: Improper cleanup

## Matrix

| Area | Failure evidence | Current status | Classification | Resolution |
| --- | --- | --- | --- | --- |
| Auth registration | `Register Admin` returned 500; citizen/provider registration returned 400 in dirty runs | Passing | B, C, H | Auth fixture cleanup expanded to include all fixed auth users and related records. |
| Provider credential tests | Unique constraint failures for `provider2-auth@test.com`, `provider2-suspended@test.com`, `provider-reset-auth@test.com` | Passing | B, C, H | Fixed provider fixture cleanup and dependency cleanup. |
| Provider reset/invite tests | Reset/invite paths returned 403 after earlier auth setup failed | Passing | C, H | Stabilized cleanup so admin setup is deterministic. |
| Firebase citizen sync | Email/phone profile sync returned unexpected state or 500 in dirty runs | Passing | B, C, H | Added phone and login-history cleanup for auth fixtures. |
| Report workflow | Unique constraint failures for fixed `wf-*` users | Passing | B, C, H | Added prefix-based workflow artifact cleanup before/after suite. |
| Report completion evidence | Upload artifact directories remained under `uploads/report-completion` | Passing | H | Added cleanup for report-specific completion upload directories. |
| Trust dashboard summary | Recent compliance count dropped to 0 during overlapped runs | Passing | C | Confirmed as shared database interference when test commands overlap. |
| Rate-limit tests | Login returned 401/500 or FK errors during overlapped/dirty runs | Passing | C, D, H | Sequential validation passes; no rate-limit production logic changed. |
| Backup create | Historical Phase 7A `platform-tools` backup create returned 500 | Passing in current full suite | C or H, pending 7B-B investigation | Deferred to Phase 7B-B implementation analysis. |
| Demo generation | Historical Phase 7A demo generation returned 500 | Passing in current full suite | C or H, pending 7B-B investigation | Deferred to Phase 7B-B implementation analysis. |

## Order dependency

The failure profile depends on database state left by a previous run or by concurrent Jest invocations. Isolated targeted runs for auth and report workflow pass after cleanup hardening.

## Remaining warning

The `pg` deprecation warning is not causing test failure, but should be tracked separately as technical debt.

