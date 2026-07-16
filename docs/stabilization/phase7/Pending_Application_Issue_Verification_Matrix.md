# Pending Application Issue Verification Matrix

Date: 2026-07-16

## Classification key

- A: Confirmed backend defect
- B: Confirmed Flutter defect
- C: Cross-layer state synchronization defect
- D: Missing implementation
- E: Placeholder or intentionally deferred feature
- F: Environment/configuration dependency
- G: Stale-state or timing defect
- H: Validation or error-mapping defect
- I: Historical issue not currently reproducible
- J: Governance or scope ambiguity

| Area | Role | Expected behavior | Verification status | Classification | Phase 7B-C action |
| --- | --- | --- | --- | --- | --- |
| Provider expired offer acceptance | Provider | Expired offer should not start work and should return to dispatch | Reproduced by focused e2e | A, G | Fixed |
| Provider after reassignment | Provider | Old provider must not accept after reassignment; new provider can accept | Verified by focused e2e | I | Covered with regression test |
| Repeated reassignment | Admin/dispatch | Reassign should not leave multiple eligible providers | Existing backend flow cancels then assigns; no failure reproduced in selected test | I | Documented |
| Email/password login | Citizen/provider/admin | Email login should work for users with password hashes | Existing auth e2e passed | I | No change |
| Email verification/recovery | User | Verification and recovery should be explicit if supported | No complete implementation verified | D/E | Deferred |
| Firebase dev test-phone dependency | Citizen | Dev-only Firebase assumptions must not be production dependency | Not modified | F | Deferred for configuration review |
| Notification back arrow | Citizen/provider/admin | Back navigation should follow Flutter routing model | Not implemented in selected tranche | I/J | Deferred |
| Notification deep-link target | Citizen/provider/admin | Report notifications should open authorized target safely | Not implemented in selected tranche | I/J | Deferred |
| Duplicate report detection | Citizen/admin | Conservative duplicate warning should be available | Missing implementation | D | Deferred |
| Backup restore/download controls | Super admin | Controls should be real or clearly unavailable | Out of scope by current instruction | E/J | Deferred |
| Payment/plan upgrade controls | Provider/admin | Controls should not imply live payment gateway | Out of scope | E | Deferred |
| Exports | Admin | Export controls require approved scope | Out of scope | E | Deferred |

## Selected implementation

Only the confirmed backend provider timer/assignment defect was implemented.

