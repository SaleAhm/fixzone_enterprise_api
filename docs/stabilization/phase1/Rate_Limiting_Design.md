# Rate Limiting Design

Date: 2026-07-09
Branch reviewed: `phase-4-platform-expansion`
Status: Design only; do not implement yet.

## Current State

- No rate limiting dependency or decorators are present in `package.json` or `src`.
- `configureApp` sets global JSON and urlencoded body limits to `8mb`, but does not throttle requests.
- Public endpoints exist for auth and onboarding:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/firebase-login`
  - `POST /api/onboarding/citizen/register`
  - `POST /api/onboarding/provider/request-access`
  - `POST /api/onboarding/organization/register`
  - `GET /api/platform-tools/maintenance/public`
- Protected high-value endpoints exist across report, evidence, notifications, admin, platform tools, trust, users, organization, demo data, and platform configuration.

## Recommended Approach

Use Nest's official throttling package, `@nestjs/throttler`, and configure it globally from a dedicated rate-limit module. Apply conservative global defaults, then stricter route-specific policies for credential, registration, upload, and admin mutation endpoints.

If the API will run behind a proxy or load balancer, configure trusted proxy behavior before rollout so throttling keys use the real client IP instead of only the proxy IP. For authenticated requests, prefer a custom throttler guard key that includes `user.id` when available and falls back to IP for unauthenticated requests.

## Proposed Rate Limit Tiers

| Tier | Target | Suggested limit |
| --- | --- | --- |
| Global API | All routes unless overridden | 120 requests/minute per user or IP |
| Public read | `GET /api/platform-tools/maintenance/public` | 60 requests/minute per IP |
| Auth login | `POST /api/auth/login`, `POST /api/auth/firebase-login` | 5 requests/minute and 20 requests/hour per identifier/IP |
| Registration | auth and onboarding registration endpoints | 3 requests/minute and 10 requests/hour per IP |
| Upload/evidence | report evidence, completion evidence, trust evidence, KYC submit | 6 requests/minute and 30 requests/hour per user |
| Notification reads | notification list/count | 60 requests/minute per user |
| Notification mutations | mark read/read-all | 30 requests/minute per user |
| Admin reads | dashboards, audit, users, organization, platform config | 60 requests/minute per user |
| Admin mutations | assignment, status, user, organization, platform tools, demo data, trust review | 10 requests/minute per user |
| Heavy admin jobs | backup create/restore, demo generate/reset/purge, overdue assignment/dispute processing, cache clear | 2 requests/minute and 10 requests/hour per user |

## Route-Specific Placement

### Auth And Onboarding

Apply the strictest limits to:

- `src/auth/auth.controller.ts`
  - `POST register`
  - `POST login`
  - `POST firebase-login`
  - `PATCH me`
- `src/onboarding/onboarding.controller.ts`
  - `POST citizen/register`
  - `POST provider/request-access`
  - `POST organization/register`

Rationale: these endpoints are credential, account creation, and abuse magnets. Login should be keyed by IP plus normalized email/phone/provider ID where feasible.

### Report And Evidence

Apply upload limits to:

- `src/report/report.controller.ts`
  - `POST :id/evidence`
  - `POST :id/completion-evidence`

Apply mutation limits to:

- `POST /api/report`
- assignment, cancellation, reassignment, status, reject, confirm/reject completion, recommend provider, and auto-assign routes.

Apply dashboard read limits to:

- `GET /api/report/admin/dashboard/*`
- `GET /api/report`
- `GET /api/report/:id`
- `GET /api/report/:id/timeline`

### Trust, Identity, Records, And Disputes

Apply upload/evidence limits to:

- `src/trust/records.controller.ts`
  - `POST records/evidence`
- `src/trust/identity.controller.ts`
  - `POST identity/kyc/submit`

Apply admin mutation limits to:

- KYC review
- trust enforcement settings update
- dispute status, assign, escalate, and overdue escalation routes.

Apply read limits to:

- identity, entitlements, login history, evidence list/detail, dispute list/detail, compliance audit, trust summary.

### Notifications

Apply moderate per-user read limits to:

- `GET /api/notifications`
- `GET /api/notifications/unread-count`

Apply mutation limits to:

- `PATCH /api/notifications/read-all`
- `PATCH /api/notifications/:id/read`

### Admin And Platform Operations

Apply admin read/mutation/heavy-job limits to:

- `src/users/users.controller.ts`
- `src/organization/organization.controller.ts`
- `src/platform-tools/platform-tools.controller.ts`
- `src/platform-configuration/platform-configuration.controller.ts`
- `src/demo-data/demo-data.controller.ts`
- `src/business-logic/business-logic.controller.ts`

The most restrictive limits should cover:

- Backup create, restore, delete, download.
- Demo generate, reset, purge.
- Cache clear.
- Maintenance changes.
- User password reset and invitation resend.
- Organization activation, suspension, archival.
- Platform service/capability changes.

## Exact File-Change Plan For Later

Do not implement during this review. When approved, change these files:

- `package.json` and `package-lock.json`: add `@nestjs/throttler`.
- `src/app.module.ts`: import a new rate-limit module.
- `src/security/rate-limit.module.ts`: define named throttling policies and global throttler guard registration.
- `src/security/rate-limit.guard.ts`: optional custom guard to key authenticated requests by user ID and unauthenticated requests by IP.
- `src/security/rate-limit.constants.ts`: centralize tier names and limit values.
- `src/auth/auth.controller.ts`: add route-specific throttling decorators for login/register/firebase-login/profile update.
- `src/onboarding/onboarding.controller.ts`: add route-specific throttling decorators for public registration/access request routes.
- `src/report/report.controller.ts`: add upload, dashboard, and mutation throttles.
- `src/trust/records.controller.ts`: add evidence creation throttles.
- `src/trust/identity.controller.ts`: add KYC, admin review, audit, and trust-setting throttles.
- `src/trust/disputes.controller.ts`: add dispute create/message/admin mutation throttles.
- `src/notification/notification.controller.ts`: add read and mutation throttles.
- `src/users/users.controller.ts`: add admin read/mutation throttles.
- `src/organization/organization.controller.ts`: add admin read/mutation throttles.
- `src/platform-tools/platform-tools.controller.ts`: add public, admin, and heavy-job throttles.
- `src/platform-configuration/platform-configuration.controller.ts`: add admin read/mutation throttles.
- `src/demo-data/demo-data.controller.ts`: add heavy-job throttles.
- `src/business-logic/business-logic.controller.ts`: add admin read throttles if global limits are insufficient.
- `src/configure-app.ts`: confirm proxy/IP handling and keep body limits aligned with upload hardening.
- `.env.example` or README, if present later: document rate-limit environment overrides if limits are configurable.

No migration changes are required.

## Test Plan

Add focused e2e tests:

- `test/rate-limiting.e2e-spec.ts`
  - Login returns `429` after configured failed attempts from the same client.
  - Registration/onboarding routes return `429` after configured bursts.
  - Authenticated upload endpoints are keyed by user, not only route.
  - Admin heavy-job endpoint returns `429` after the low threshold.
  - Normal traffic below thresholds still succeeds.

Extend existing suites where useful:

- `test/auth.e2e-spec.ts`: login/register throttling smoke coverage.
- `test/report-workflow.e2e-spec.ts`: report evidence/completion evidence throttling.
- `test/trust.e2e-spec.ts`: records evidence and KYC submit throttling.
- `test/platform-tools.e2e-spec.ts` and `test/demo-environment.e2e-spec.ts`: heavy admin operation throttling.

Add unit tests if a custom guard is created:

- Validate tracker key selection: authenticated user ID, unauthenticated IP, and forwarded IP behavior.
- Validate route tier mapping and default fallback.

## Dependency Assessment

A new dependency is required for the recommended Nest-native implementation:

- Required: `@nestjs/throttler`
- No database migration required.
- No Redis dependency is required for a single-node deployment.
- For multi-instance production, add a shared throttling store later, preferably Redis. That would be an additional infrastructure dependency and should be planned separately.

## Risk Notes

- In-memory throttling is not enough for horizontally scaled production because limits are per process.
- Incorrect proxy/IP handling can either collapse all users into one throttling bucket or let attackers rotate spoofed forwarding headers.
- Login throttling must avoid account enumeration. Error bodies should remain generic and consistent.
- Limits that are too aggressive may block legitimate field workers with unstable mobile connections.
- Heavy admin operations need low limits because they can trigger database, filesystem, and CPU-heavy work.
- Rate limiting must be observable. Later implementation should add structured `429` logging without exposing secrets or request bodies.

## Concise Implementation Plan Before Coding

1. Add `@nestjs/throttler` and create a dedicated security rate-limit module.
2. Register a global throttler guard with safe defaults.
3. Add named route-specific policies for auth, onboarding, uploads, notifications, admin reads, admin mutations, and heavy jobs.
4. Add a custom tracker only if authenticated user/IP behavior cannot be achieved cleanly with the stock guard.
5. Add e2e tests for 429 behavior and non-throttled happy paths.
6. Re-run auth, report workflow, trust, platform tools, and demo environment test suites before merging.
