# Notification Read State Assessment

## Scope

This document records read/unread behavior reviewed and stabilized in Phase 7B-D.

## Backend read-state endpoints

- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

The backend scopes notifications by authenticated user ID and rejects unauthorized mutation of another user's notification.

## Flutter behavior before stabilization

Citizen:

- tapping an unread notification marked that notification as read;
- unread count was refreshed after single-read;
- mark-all-read refreshed the list but did not immediately push `0` to the parent badge callback.

Provider:

- dashboard notification card marked a notification read before opening details;
- no global provider unread badge was identified in scope.

## Stabilization applied

Citizen:

- mark-all-read now immediately calls `onUnreadChanged(0)`;
- invalid notification targets still refresh the list after safe messaging;
- single-notification read behavior remains scoped to one notification.

Provider:

- single notification read behavior remains scoped to one notification;
- invalid or inaccessible targets show safe messages and refresh the notification card.

## Validation

Automated validation:

- notification target unit tests passed;
- full Flutter tests passed;
- focused backend report/trust e2e suites passed, confirming notification generation and access assumptions.

## Remaining limitation

No authenticated browser session was used to manually verify live unread badge updates across every role. This should be part of the next manual closure pass.
