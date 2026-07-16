# Demo Generation Root Cause Assessment

Date: 2026-07-16

## Endpoint

`POST /api/admin/platform-tools/demo-environment/generate`

## Required access

`SUPER_ADMIN` authenticated with JWT.

## Historical failure

Phase 7A observed HTTP 500 during demo environment generation.

## Confirmed current defect

Repeated demo generation could fail because some user-unique fields were not batch-scoped:

- provider IDs were static (`DEMO-PRV-001`, etc.);
- phone numbers used timestamp-derived values that were not tied to the demo batch.

Because `User.providerId` and `User.phone` are unique, repeated generation could collide with existing demo users.

## Classification

- A: Production runtime defect
- F: Stale artifact/state sensitivity
- G: Non-idempotent workflow
- K: Rapid-operation collision

## Fix

- Demo provider IDs now include a batch suffix.
- Demo phone numbers are derived from the batch ID and per-batch sequence.
- Existing demo email generation already included the batch ID and was preserved.

## Regression coverage

Added test:

`supports repeated demo generation without unique fixture collisions`

The test generates demo data twice without purging between requests, verifies both requests succeed, confirms distinct demo batch IDs, verifies demo phone uniqueness, then purges demo data.

## Remaining limitations

Demo generation intentionally allows multiple demo batches to exist until purged. Phase 7B-B did not change that product behavior.

