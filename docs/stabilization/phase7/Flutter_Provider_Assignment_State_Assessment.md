# Flutter Provider Assignment State Assessment

## Scope

This assessment maps the Flutter provider surfaces affected by assignment expiry and reassignment.

## Screens and services reviewed

| Area | File | Role |
| --- | --- | --- |
| Provider jobs list | `lib/features/provider/presentation/screens/provider_jobs_screen.dart` | Lists assigned, in-progress, and completed jobs |
| Provider job details | `lib/features/provider/presentation/screens/provider_job_details_screen.dart` | Accept, reject, complete, timeline, evidence |
| Provider dashboard | `lib/features/provider/presentation/screens/provider_dashboard_screen.dart` | Recent assignments and notification card |
| Provider data service | `lib/features/provider/services/provider_data_service.dart` | Dashboard aggregation from `/report/assigned` |
| API service | `lib/core/services/api_service.dart` | Report, notification, and assignment endpoints |

## Backend fields used

- `status`
- `assignedProviderId`
- `assignmentDeadlineAt`
- `lastAssignmentOutcome`
- `lastAssignmentReason`
- `lastAssignmentProviderId`

## Root cause

Provider job details previously treated any non-empty `assignedProviderId` as assigned to the current provider. This meant an old notification or stale screen could present valid-looking controls after reassignment. The jobs list also based accept/reject controls primarily on `status == assigned`, not on current-provider ownership and deadline validity.

## Stabilization applied

Added `ProviderAssignmentActionState` and wired it into provider job list and detail screens.

Action controls are now disabled when:

- the assignment deadline has passed;
- the report is not assigned to the authenticated provider;
- the report has returned to pending dispatch;
- the job is already in progress;
- the job is awaiting citizen confirmation;
- the job is terminal or otherwise not actionable.

Backend responses remain authoritative. Client-side deadline checks are used only to avoid stale affordances; the backend still enforces validity.

## Error handling

Flutter now maps backend workflow conflicts into user-facing messages:

- `409 Assignment acceptance window expired` → assignment returned to dispatch
- `403` → assignment no longer available to this provider account
- `404` → job no longer available

After conflict responses, the relevant report/list state is refreshed.

## Tests

`test/provider_assignment_state_test.dart` covers:

- current assigned provider before deadline can accept/reject;
- expired assignment disables actions;
- superseded provider after reassignment cannot act.

## Remaining limitation

Manual authenticated verification should still confirm the UI state after real backend expiry/reassignment events in a browser session.
