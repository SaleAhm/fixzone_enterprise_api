# Completion Governance And Multi-Party Verification

Date: 2026-08-05

Result: PASS WITH NOTES - Stage B completion-governance slice is implemented and locally verified.

## Root Cause

The previous completion flow treated citizen approval as the universal final closure action. That collapsed distinct governance responsibilities into one action:

Provider submits completion evidence -> citizen confirms -> report closes.

That is acceptable for citizen-only policies, but it is not production-ready for organization-owned work where operational verification, disputes, rework, and exceptional platform resolution must remain auditable.

## Anti-Bias Principle

The citizen must not be the sole final completion authority for every report. Citizen confirmation, rating, and feedback are important inputs, but final closure now follows the configured policy used for the report. Organization verification can be required, both parties can be required, either party can be enough, or ordinary closure can be blocked for platform resolution.

## Policy Model

The backend adds durable report-level completion governance fields:

- `completionPolicy`
- `completionPolicySource`
- `completionReviewState`
- `completionReviewDeadlineAt`
- `completionReviewProcessedAt`
- `completionFallbackRule`
- `completionFinalActorType`
- `completionGovernanceHoldReason`
- `citizenCompletionDecision`
- `citizenCompletionDecidedAt`
- `organizationCompletionDecision`
- `organizationCompletionDecidedAt`
- `organizationCompletionDecidedById`
- `organizationCompletionReason`
- `completionFinalizedAt`
- `completionFinalizedById`
- `completionFinalizedByRole`
- `completionClosureReason`
- `completionDisputeReason`

Supported policies:

- `CITIZEN_CONFIRMATION_REQUIRED`
- `ORGANIZATION_CONFIRMATION_REQUIRED`
- `BOTH_REQUIRED`
- `CITIZEN_OR_ORGANIZATION`
- `ADMIN_RESOLUTION_REQUIRED`
- `AUTO_CLOSE_AFTER_REVIEW_WINDOW`

Supported decisions:

- `PENDING`
- `CONFIRMED`
- `VERIFIED`
- `REWORK_REQUESTED`
- `DISPUTED`
- `ESCALATED`

## Policy Precedence

This tranche uses the safest available existing configuration sources without adding a new policy table:

1. Existing report `completionPolicy`, when already persisted.
2. Organization category policy from `profileData.completionPoliciesByCategory`, `profileData.categoryCompletionPolicies`, or `profileData.serviceConfiguration.completionPoliciesByCategory`.
3. Persisted platform category policy from `PlatformSetting.completionPoliciesByCategory`.
4. Organization `profileData.completionPolicy`, resolved when provider completion is submitted.
5. Platform default from `FIXZONE_COMPLETION_POLICY`.
6. Fallback default: `CITIZEN_CONFIRMATION_REQUIRED`.

Environment category JSON remains a compatibility fallback when no persisted platform category setting exists. Category matching reuses the existing category normalization and compatibility helpers used for responsibility routing. No duplicate category table was introduced.

## Lifecycle States

Provider completion still moves the report to `COMPLETED_BY_PROVIDER`, but governance-specific state is now stored separately in `completionReviewState`, including:

- `AWAITING_CITIZEN_REVIEW`
- `AWAITING_ORGANIZATION_VERIFICATION`
- `AWAITING_BOTH`
- `AWAITING_ADMIN_RESOLUTION`
- `AWAITING_REVIEW_WINDOW`
- `REWORK_REQUESTED`
- `DISPUTED`
- `CLOSED`

This preserves backward compatibility with existing status-driven code while exposing the more precise state needed for review flows and analytics.

## Provider Role

Provider completion still requires completion evidence. On submission, the backend:

- resolves and persists the policy used;
- resets citizen and organization decisions to `PENDING`;
- records the review state and optional deadline;
- clears prior finalization or dispute fields for the new submission;
- notifies the required reviewers through existing in-app notifications;
- records the existing provider completion activity and workflow audit path.

The frontend provider waiting message now says completion is awaiting required review instead of assuming citizen-only review.

## Citizen Role

Citizen review now records citizen confirmation independently from final closure:

- Citizen-only policy closes on confirmation.
- Organization-only policy saves rating and feedback but waits for organization verification.
- Both-required policy saves citizen decision and waits for the organization if needed.
- Either-party policy can close through citizen confirmation unless a blocker exists.
- Admin-resolution policy records inputs but does not close through ordinary citizen approval.

Repeated citizen confirmation is safely rejected with `403` after the first accepted decision. Citizen rework requests return the report to assigned work and block ordinary closure.

The citizen completion screen now shows policy guidance from the authoritative API response and no longer assumes a successful confirmation means the report is closed.

## Organization Role

The backend adds organization completion-review endpoints for organization-scoped operational users:

- `GET /api/report/organization/completion-review`
- `GET /api/report/organization/completion-review/:id`
- `POST /api/report/:id/organization-completion/verify`
- `POST /api/report/:id/organization-completion/rework`

Authorized roles:

- `ORG_ADMIN`
- `DISPATCH_OFFICER`

Organization verification:

- requires the report to belong to the user's organization;
- records actor, timestamp, decision, and optional reason;
- closes only when the policy is satisfied;
- does not override active rework or dispute states;
- creates audit and report-activity records.

The organization queue is named `Completion Review` in the Flutter admin workspace. It is visible only to `ORG_ADMIN` and `DISPATCH_OFFICER` users with an organization context. It lists organization-owned reports waiting in completion governance, including tracking ID, title, category, location, provider, provider completion timestamp, applied policy, citizen and organization decision labels, review state, deadline status, dispute/rework flags, and evidence count. It provides loading, empty, error, manual refresh, duplicate-submission prevention, verify confirmation, and required rework-reason flows.

Organization rework:

- requires a reason;
- returns the report to assigned work;
- records organization decision metadata;
- notifies the provider and citizen through existing in-app notifications;
- creates audit and report-activity records.

Full organization review queue UI is not completed in this tranche. The frontend API client is ready for the new organization actions.

## Super Admin Role

Super Admin remains the exceptional governance actor rather than an ordinary verifier for every report. This tranche exposes completion governance data in enterprise report details so privileged review screens can inspect:

- policy used;
- review state;
- citizen decision;
- organization decision;
- final actor and role;
- closure or dispute reason;
- hold state and deadline processing state.

Super Admin completion governance endpoints now exist:

- `GET /api/report/admin/completion-governance`
- `POST /api/report/:id/admin-completion/resolve-close`
- `POST /api/report/:id/admin-completion/rework`
- `POST /api/report/:id/admin-completion/hold`
- `POST /api/report/:id/admin-completion/remove-hold`
- `POST /api/report/:id/admin-completion/reopen`
- `POST /api/report/:id/admin-completion/policy`
- `GET /api/report/admin/completion-governance/category-policy`
- `POST /api/report/admin/completion-governance/category-policy`

Every mutation requires `SUPER_ADMIN`, a non-empty reason, records previous and resulting state in report activity/audit metadata, and sends persistent in-app notifications through the existing notification table. Ordinary organization/admin roles are not allowed to call these routes.

The Flutter admin shell now exposes a separate Super Admin-only `Completion Governance` workspace. It is distinct from organization `Completion Review` and provides queue, filters, counters, loading/error/empty states, deadline preview, separate reason-required deadline execution, report policy override, category policy administration, and reason-required action dialogs for resolve, rework, hold, unhold, and reopen. The UI uses backend action flags to avoid showing ordinary organization-only actions in this workspace.

## Dispute And Rework

Citizen and organization rework requests now block ordinary closure by setting review state to `REWORK_REQUESTED` and preserving the reason. Active `DISPUTED` and `REWORK_REQUESTED` states are checked before ordinary citizen or organization closure paths can proceed.

Provider revised completion is supported by the existing provider completion path: a new provider completion submission clears prior decision/finalization fields and returns the report to the applicable review state. Previous evidence is not deleted.

The broader dispute model was not expanded in this tranche. Existing dispute endpoints remain the source for dispute workflows.

## Review Window Behavior

`AUTO_CLOSE_AFTER_REVIEW_WINDOW` now persists `completionReviewDeadlineAt` based on `FIXZONE_COMPLETION_REVIEW_WINDOW_HOURS`, defaulting to 72 hours.

This tranche adds an idempotent protected processor endpoint:

- `POST /api/report/admin/completion-review/process-deadlines`

Authorized roles:

- `SUPER_ADMIN`
- `COMPLIANCE_ADMIN`
- `REGULATORY_ADMIN`

The processor closes only reports that are still `COMPLETED_BY_PROVIDER`, use `AUTO_CLOSE_AFTER_REVIEW_WINDOW`, and have a deadline at or before processing time. It skips active dispute, active rework, governance hold, already processed, and already closed reports. It records `completionReviewProcessedAt`, `completionFallbackRule`, `completionFinalActorType`, final actor role, closure reason, report activity, audit event, and ordinary closure notifications.

Dry-run mode returns classified preview counts:

- eligible;
- blocked by dispute;
- blocked by rework;
- blocked by hold;
- already processed;
- already closed;
- not yet due;
- invalid or incomplete;
- processed and skipped counts.

No scheduler module was found or enabled. The processor response explicitly reports `automatedSchedulerActive: false`; an approved cron or worker must call this endpoint before review-window closure is truly automated. No citizen or organization approval is fabricated after timeout.

Manual execution requires an authorized processor role, a bounded batch size, and a non-empty reason. The frontend keeps execution disabled until a successful preview has been returned and displays skipped/blocked counts truthfully instead of reporting unconditional success.

## Schema And Migration

Migration:

- `prisma/migrations/20260804143000_completion_governance_fields/migration.sql`
- `prisma/migrations/20260804162000_completion_governance_operational_fields/migration.sql`

The migration is additive and backward-compatible:

- creates `CompletionPolicy`;
- creates `CompletionDecision`;
- adds nullable governance columns to `Report`;
- adds indexes for policy, review state, and review deadline;
- adds processor metadata fields for fallback authority and operational holds.

Migration deployment was run against the isolated local development database only. The first local attempt exposed duplicate index statements because `20260804143000_completion_governance_fields` had already created the policy, review-state, and deadline indexes. The operational migration was corrected to add only the four nullable processor/hold columns; the local failed attempt was resolved without resetting the database. `prisma migrate status` now reports the local schema as up to date. No database reset was performed.

## API Contracts

Organization verify request:

```json
{
  "reason": "Optional verification note"
}
```

Organization rework request:

```json
{
  "reason": "Required rework reason"
}
```

Citizen completion review responses now include `completionGovernance` so clients can display policy-aware guidance and available actions.

Enterprise report details now include `enterpriseDetails.completionGovernance`.

Super Admin action requests:

```json
{
  "reason": "Required governance reason"
}
```

Report policy override request:

```json
{
  "policy": "BOTH_REQUIRED",
  "reason": "Required governance reason"
}
```

Category policy request:

```json
{
  "category": "telecom",
  "policy": "BOTH_REQUIRED",
  "organizationId": "optional-org-id",
  "reason": "Required governance reason"
}
```

Category policy read response:

```json
{
  "scope": "PLATFORM_SERVICE_CATEGORY",
  "categories": [
    {
      "category": "telecom",
      "label": "telecom",
      "policy": "BOTH_REQUIRED",
      "source": "PLATFORM_SERVICE_CATEGORY",
      "fallbackPolicy": "CITIZEN_CONFIRMATION_REQUIRED"
    }
  ],
  "policies": [
    "CITIZEN_CONFIRMATION_REQUIRED",
    "ORGANIZATION_CONFIRMATION_REQUIRED",
    "BOTH_REQUIRED",
    "CITIZEN_OR_ORGANIZATION",
    "ADMIN_RESOLUTION_REQUIRED",
    "AUTO_CLOSE_AFTER_REVIEW_WINDOW"
  ],
  "scheduler": {
    "automatedSchedulerActive": false,
    "requirement": "Invoke the protected deadline endpoint from an approved cron or worker until a scheduler module is enabled."
  }
}
```

Organization completion review queue response:

```json
{
  "workspace": "Completion Review",
  "organizationId": "org-id",
  "total": 1,
  "limit": 25,
  "offset": 0,
  "items": [
    {
      "id": "report-id",
      "trackingId": "report-id",
      "title": "Street light repaired",
      "category": "Lighting",
      "location": "Human-readable location",
      "providerCompletedAt": "2026-08-04T14:30:00.000Z",
      "policy": "Citizen and organization approval required",
      "policyCode": "BOTH_REQUIRED",
      "policySource": "ORGANIZATION_SERVICE_CATEGORY",
      "citizenDecisionStatus": "Confirmed",
      "organizationDecisionStatus": "Pending",
      "reviewState": "Citizen confirmed - organization pending",
      "reviewDeadlineStatus": "No deadline",
      "evidenceCount": 2
    }
  ]
}
```

## Authorization

Implemented and tested:

- citizen can review only their own report;
- cross-tenant citizen review is rejected;
- provider cannot confirm as citizen;
- organization users must belong to the report organization to verify;
- organization queue and detail access are scoped to the authenticated user's organization;
- Super Admin governance actions require `SUPER_ADMIN`;
- completion governance hold blocks ordinary citizen, organization, and deadline closure;
- duplicate citizen confirmation is rejected;
- active rework or dispute blocks ordinary closure paths.

Provider self-verification as an organization actor is guarded by role and organization membership, but no additional explicit self-provider identity rule was added in this tranche.

## Audit And Notifications

Existing audit and activity infrastructure is reused.

New organization actions record:

- `Organization Verified Completion`
- `Organization Requested Completion Rework`
- `ORGANIZATION_VERIFIED_COMPLETION`
- `ORGANIZATION_REQUESTED_COMPLETION_REWORK`

New Super Admin actions record:

- `ADMIN_COMPLETION_RESOLVED_CLOSED`
- `ADMIN_COMPLETION_RETURNED_FOR_REWORK`
- `ADMIN_COMPLETION_HOLD_PLACED`
- `ADMIN_COMPLETION_HOLD_REMOVED`
- `ADMIN_COMPLETION_REOPENED`
- `ADMIN_COMPLETION_POLICY_OVERRIDDEN`
- `COMPLETION_REVIEW_WINDOW_FALLBACK_CLOSED`

Provider completion now sends truthful in-app notifications to the required reviewer group for the selected policy. Citizen confirmation under a still-pending organization policy notifies organization operators. Organization rework notifies the assigned provider and citizen. Deadline fallback sends the existing closure notifications and records an explicit activity event. No email, SMS, or push delivery is claimed.

Duplicate citizen confirmation is rejected before producing another notification. Persistent in-app notification creation now checks for an existing same user/report/type/title/message record before creating another copy, which makes deadline retries and repeated no-op actions safer.

## Analytics Implications

Persisted data now supports truthful calculation of:

- provider completion submission time;
- citizen decision time;
- organization verification time;
- final closure actor and role;
- policy used;
- rework/dispute rates from decision and review-state fields;
- review-window deadlines.

Existing analytics queries were not broadly rewritten in this tranche.

`getDashboardSummary` now includes a `completionGovernance` object with real persisted counters for Super Admin, organization, provider, and citizen governance buckets. Legacy status counters remain unchanged for compatibility.

## Tests

Backend coverage added:

- policy helper tests for citizen-only, organization-only, both-required, either-party, admin-resolution, rework/dispute states, and blockers;
- category policy precedence tests for report override and organization service-category policy;
- deadline skip tests for rework and hold blockers;
- persisted platform category policy precedence test;
- e2e organization-confirmation policy where citizen feedback remains saved until organization verification closes;
- e2e both-required policy where either approval order waits for the missing approval;
- existing duplicate citizen confirmation test preserved and passing.

Frontend validation added admin navigation coverage for the organization `Completion Review` destination and the Super Admin `Completion Governance` destination. The full Flutter test suite remains green after adding the Super Admin workspace.

Verified locally on 2026-08-05:

- `npx prisma format`: passed.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npx prisma migrate status`: 27 migrations, schema up to date.
- `npm run build`: passed.
- `npm test -- report.service.spec.ts --runInBand`: 1 suite / 37 tests passed.
- `npm test -- --runInBand`: 20 suites / 174 tests passed.
- `npm run test:e2e -- report-workflow.e2e-spec.ts --runInBand`: 1 suite / 32 tests passed.
- `dart format` on touched frontend files: completed.
- `flutter analyze`: passed.
- `flutter test test/admin_navigation_test.dart`: 10 tests passed.
- `flutter test`: 111 tests passed.
- `flutter build web`: passed.

## Remaining Known Limitations

- No scheduler/worker is installed for the deadline processor yet.
- No expanded dispute model beyond blocking ordinary closure and preserving rework/dispute state.
- No repository-wide ESLint cleanup was attempted because strict unsafe-typing debt is pre-existing and out of scope.
- Platform category policy administration stores governed settings and provider-completion policy resolution now consumes those persisted platform category settings before organization defaults and environment fallback.
- Browser UAT with real authenticated Super Admin and organization accounts is still pending.

## Browser UAT Checklist

1. Create a report under an organization with default citizen-only policy; provider uploads completion evidence; citizen confirms; verify the report closes.
2. Set organization `profileData.completionPolicy` to `ORGANIZATION_CONFIRMATION_REQUIRED`; provider completes; citizen confirms; verify rating/feedback save while status remains provider-completed; organization verifies; verify closure.
3. Set policy to `BOTH_REQUIRED`; verify organization-first and citizen-first orders both wait for the missing decision.
4. Trigger citizen rework; verify closure is blocked and provider sees the rework reason.
5. Trigger organization rework through API; verify provider and citizen notifications appear.
6. Verify another organization cannot verify a report it does not own.
7. Verify duplicate citizen confirmation after closure is rejected.
8. Inspect Super Admin report detail and confirm completion governance fields are visible in API responses.
9. Confirm provider completion evidence galleries remain available and previous evidence is not deleted by revised completion.
10. Open organization `Completion Review`; verify loading, empty, error, verify, and rework reason flows.
11. Call the protected deadline processor with a past review-window report and confirm fallback closure records authority without adding citizen or organization approval.
12. Open Super Admin `Completion Governance`; verify organization users cannot see it.
13. Resolve and close a governance report with a mandatory reason.
14. Place and remove a governance hold; confirm ordinary closure is blocked while held.
15. Reopen a closed report and verify evidence/decision history remains visible.
16. Override a report policy and verify activity/audit records the previous and new policy.
