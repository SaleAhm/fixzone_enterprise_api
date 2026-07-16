# Notification Navigation Root Cause Assessment

## Scope

This assessment covers notification back navigation and deep-link routing for citizen and provider workflows.

## Workflow map

Backend:

- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

Flutter:

- Citizen notification screen: `lib/features/citizen/presentation/screens/citizen_notifications_screen.dart`
- Provider notification card: `lib/features/provider/presentation/screens/provider_dashboard_screen.dart`
- Shared target resolver: `lib/core/services/notification_navigation.dart`

## Structured notification metadata

The current backend contract provides enough metadata for safe navigation:

- notification `id`
- notification `type`
- notification `reportId`
- notification `read`
- related `report` object

No message-text parsing is required.

## Root causes

1. Citizen back navigation used `Navigator.maybePop` without a role-safe fallback. After direct route loading or browser refresh, the back button could fail to return to a meaningful screen.
2. Citizen and provider notification taps did not explicitly handle missing report metadata, inaccessible reports, or deleted reports before navigating.
3. Provider notification routing assumed `reportId` was present and valid.

## Fix

Added `NotificationNavigation` to resolve notification targets from structured metadata.

Citizen behavior:

- completion-review notifications open the citizen review screen;
- other report notifications open citizen report details;
- missing target shows a safe informational message;
- back arrow falls back to `AppRoutes.citizenHome` if no navigation history exists.

Provider behavior:

- report-backed notifications open provider job details;
- missing target shows a safe informational message;
- inaccessible/deleted report targets show safe error messages and refresh the card.

## Authorization handling

Before opening a notification target, Flutter requests the current resource through the backend. Backend authorization remains the source of truth. `403` and `404` responses are shown as safe user-facing messages.

## Tests

`test/notification_navigation_test.dart` covers:

- citizen completion-review target;
- citizen report details target;
- provider job details target;
- safe no-target notification state.

## Remaining limitation

Admin/organization notification pages were not identified as dedicated Flutter screens in this tranche. Their broader cross-role notification UX should be covered in a future authenticated walkthrough if product scope requires equivalent deep links.
