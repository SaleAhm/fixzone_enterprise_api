# Phase 7B-D Cross-Layer Failure Matrix

| ID | Role | Screen | Expected behavior | Actual finding | Class | Severity | Resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 7BD-01 | Provider | Job details | Only the current assigned provider can see assignment actions | Non-empty `assignedProviderId` was treated as assigned-to-me | B / F | High | Fixed by comparing current provider ID |
| 7BD-02 | Provider | Job details | Expired/reassigned conflicts refresh current state | Error was shown without refreshing report state | E | Medium | Fixed by refreshing after `403`, `404`, `409` |
| 7BD-03 | Provider | Jobs list | Expired/reassigned assigned jobs should not show actionable controls | Actions were derived mainly from `status` | B | High | Fixed with `ProviderAssignmentActionState` |
| 7BD-04 | Citizen | Notifications | Back arrow should return to previous or safe citizen screen | No fallback after `maybePop` failure | A | Medium | Fixed with citizen home fallback |
| 7BD-05 | Citizen | Notifications | Missing/deleted/unauthorized target should not dead-end | Target validation was incomplete | A / F | Medium | Fixed with pre-navigation backend validation |
| 7BD-06 | Provider | Notification card | Missing/deleted/unauthorized target should not dead-end | `reportId` was assumed present and valid | A / F | Medium | Fixed with structured target resolver and validation |
| 7BD-07 | Citizen | Mark all read | Badge should update after mark-all-read | Parent unread callback was not forced to zero | E | Low | Fixed |
| 7BD-08 | Backend | Notification contract | Flutter needs structured report target metadata | Existing contract has `reportId`, `type`, `read`, related report | H | None | No backend change |

## Classification key

- A: Confirmed Flutter navigation defect
- B: Confirmed Flutter stale-state defect
- E: Cross-layer synchronization defect
- F: Authorization or routing defect
- H: Expected behavior / sufficient existing contract
