# Completion Governance And Multi-Party Verification

Date: 2026-08-04

Result: PASS WITH NOTES

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
2. Organization `profileData.completionPolicy`, resolved when provider completion is submitted.
3. Platform default from `FIXZONE_COMPLETION_POLICY`.
4. Fallback default: `CITIZEN_CONFIRMATION_REQUIRED`.

Service category policy was not introduced in this tranche because there is no existing durable category-policy structure suitable for that without adding a parallel policy system.

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
- closure or dispute reason.

Dedicated Super Admin resolution endpoints, policy override controls, compliance holds, and governed reopening were not completed in this tranche.

## Dispute And Rework

Citizen and organization rework requests now block ordinary closure by setting review state to `REWORK_REQUESTED` and preserving the reason. Active `DISPUTED` and `REWORK_REQUESTED` states are checked before ordinary citizen or organization closure paths can proceed.

Provider revised completion is supported by the existing provider completion path: a new provider completion submission clears prior decision/finalization fields and returns the report to the applicable review state. Previous evidence is not deleted.

The broader dispute model was not expanded in this tranche. Existing dispute endpoints remain the source for dispute workflows.

## Review Window Behavior

`AUTO_CLOSE_AFTER_REVIEW_WINDOW` now persists `completionReviewDeadlineAt` based on `FIXZONE_COMPLETION_REVIEW_WINDOW_HOURS`, defaulting to 72 hours.

No scheduler was added. No automatic closure processor endpoint was completed in this tranche. Future work must add an idempotent processing path before this policy can be operationally relied on for timed closure.

No citizen approval is fabricated after timeout.

## Schema And Migration

Migration:

- `prisma/migrations/20260804143000_completion_governance_fields/migration.sql`

The migration is additive and backward-compatible:

- creates `CompletionPolicy`;
- creates `CompletionDecision`;
- adds nullable governance columns to `Report`;
- adds indexes for policy, review state, and review deadline.

Local migration deployment was run against the local development database only. No database reset was performed.

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

## Authorization

Implemented and tested:

- citizen can review only their own report;
- cross-tenant citizen review is rejected;
- provider cannot confirm as citizen;
- organization users must belong to the report organization to verify;
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

Provider completion now sends truthful in-app notifications to the required reviewer group for the selected policy. Citizen confirmation under a still-pending organization policy notifies organization operators. Organization rework notifies the assigned provider and citizen. No email, SMS, or push delivery is claimed.

Duplicate citizen confirmation is rejected before producing another notification.

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

## Tests

Backend coverage added:

- policy helper tests for citizen-only, organization-only, both-required, either-party, admin-resolution, rework/dispute states, and blockers;
- e2e organization-confirmation policy where citizen feedback remains saved until organization verification closes;
- e2e both-required policy where either approval order waits for the missing approval;
- existing duplicate citizen confirmation test preserved and passing.

Frontend validation reused existing tests for provider state and notification navigation plus the full Flutter suite. No new widget test was added for the citizen policy guidance text in this tranche.

## Remaining Known Limitations

- No full organization completion-review queue UI yet.
- No Super Admin governed resolution endpoint or UI yet.
- No idempotent deadline processing endpoint or scheduler yet.
- No service-category policy precedence yet.
- No expanded dispute model beyond blocking ordinary closure and preserving rework/dispute state.
- No repository-wide ESLint cleanup was attempted because strict unsafe-typing debt is pre-existing and out of scope.
- Frontend organization verification client methods exist, but the full organization review screen is still future work.

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
