# Phase 7C-A — Regression and Parity Audit

Date: 2026-07-17  
Classification: **Blocked pending fresh validation rerun**

## 1. Purpose

This audit reviewed frontend/backend parity and regression exposure for Phase 7B invitation, report-discussion, notification, Trust Center, and organization-context work.

## 2. Frontend/Backend Contract Review

### Invitation creation

- Flutter method: admin invitation creation through `ApiService.inviteUser`.
- Backend route: `POST /api/users/admin/invitations`.
- Required auth: administrator role.
- Expected behavior: create pending invitation, not a temporary-password user.
- Response expectation: invitation payload and delivery status.
- Risk: email delivery is configuration-pending; UI must not imply email was sent.

### Invitation listing

- Admin listing route: `GET /api/users/admin/invitations`.
- Invitee listing route: `GET /api/users/invitations/mine`.
- Response contains invitation status, intended role, organization reference, timestamps, and delivery metadata.

### Invitation acceptance and decline

- Accept route: `POST /api/users/invitations/:id/accept`.
- Decline route: `POST /api/users/invitations/:id/decline`.
- Backend checks invitee identity by email or phone.
- Acceptance updates organization membership and intended role.
- Provider invitation acceptance creates provider-organization linkage when applicable.

### Invitation resend and revoke

- Resend route: `POST /api/users/admin/invitations/:id/resend`.
- Revoke route: `POST /api/users/admin/invitations/:id/revoke`.
- Admin UI exposes resend/revoke for pending invitations.
- Email transport remains pending; resend updates metadata/notification state but does not prove external email delivery.

### Report-message list and create

- List route: `GET /api/report/:id/messages`.
- Create route: `POST /api/report/:id/messages`.
- Message payload: `{ "message": string }`.
- Length limit: 1200 characters.
- Empty messages rejected.
- Backend reuses report access checks.
- UI describes the feature as report discussion/case conversation, not real-time chat.

### Trust Center enforcement update

- Flutter sends only mutable fields:
  - `requireVerifiedIdentityForDisputes`
  - `requireVerifiedIdentityForProviderJobAcceptance`
  - `requireVerifiedIdentityForEvidenceUpload`
  - `requireEntitlementPlanForPriorityWorkflows`
  - `requiredPriorityPlan`
- Read-only backend fields such as `organizationId` and `blockingMode` are not posted back.
- This avoids the previous DTO rejection mismatch.

## 3. Invitation Lifecycle Readiness

Implemented:

- Pending invitation persistence.
- Invitee dashboard visibility.
- Accept action.
- Decline action.
- Admin resend action.
- Admin revoke action.
- Duplicate pending invitation prevention.
- Existing-member protection.
- Expiry handling.
- Audit logging for invitation actions.
- In-app notification creation where a matching user exists.

Configuration-pending:

- External email invitation delivery.
- Public token-link landing flow.
- Bounce/failure handling.
- Sender-domain verification.

Readiness:

- In-app invitation lifecycle: **implemented, pending fresh validation rerun**.
- Email invitation lifecycle: **configuration-pending**.
- Token-link invitation lifecycle: **deferred**.

## 4. Report-Discussion Security Review

Implemented controls:

- Report creator/citizen can access their report discussion.
- Assigned provider can access assigned report discussion.
- Organization admin and dispatch officer can access in-scope organization report discussion.
- Super admin can access globally.
- Unrelated users are rejected through the existing report authorization path.
- Cross-organization access is rejected.
- Unauthenticated requests require JWT guard and are rejected.
- Message text is trimmed and control characters are normalized.
- Message timestamps, sender id, sender role, and sender display name are persisted.
- Message creation records report activity.
- Message creation fans out in-app notifications to participants excluding the author.

Limitations:

- No pagination beyond a bounded latest-message query.
- No WebSocket/live chat.
- No attachment support in discussion messages.
- No moderation workflow.

## 5. Notification Findings

Implemented/present in Phase 7B:

- Invitation received notification for matched existing users.
- Invitation accepted notification to inviter.
- Invitation declined notification to inviter.
- Invitation revoked notification to invitee where matched.
- Report discussion message notification to participants.

Existing platform notification areas remain relevant:

- Report assignment.
- Provider progress.
- Evidence submission.
- Completion review.
- Dispute activity.

Readiness separation:

- In-app persisted notifications: implemented for Phase 7B events, pending fresh validation rerun.
- Email notifications: configuration-pending.
- Push notifications: not verified in this tranche.
- SMS notifications: not implemented/verified.

## 6. Organization and Workspace Context Findings

Current state:

- Super Admin dashboard distinguishes platform scope.
- Organization Admin and Dispatch dashboard wording identifies organization workspace but does not consistently display the concrete organization name in the primary greeting.
- Provider dashboard surfaces provider profile context but can be improved with clearer organization/provider identity placement.
- Citizen dashboard is mostly citizen-service scoped and includes module access context.

Classification:

- Super Admin: partially complete.
- Organization Admin: partially complete; organization name display should be improved.
- Dispatch Officer: partially complete; organization name display should be improved.
- Provider: partially complete.
- Citizen: partially complete.

Recommended next controlled tranche:

- Add a small authenticated workspace identity strip using existing `getMyOrganization`, profile, and token-derived role data.
- Avoid redesign; keep this additive.

## 7. Regression Matrix

Requires successful fresh validation before closure:

- Citizen OTP login.
- Provider login.
- Organization admin login.
- Super admin login.
- Citizen report submission.
- Duplicate-report handling.
- Assignment.
- AI-assisted assignment.
- Provider acceptance.
- Provider progress.
- Evidence upload.
- Completion submission.
- Citizen review.
- Rating and closure.
- Disputes.
- Records.
- Subscriptions.
- Monetization.
- Analytics.
- Trust Center.
- Invitation lifecycle.
- Report discussion.
- Notifications.
- Responsive navigation.
- Onboarding screens.

Do not claim the following as complete based on Phase 7B:

- Email authentication.
- Payment gateway.
- GIS production intelligence.
- Real-time chat.
- Production invitation email delivery.

## 8. Audit Conclusion

The contracts and implemented behavior appear coherent from source-level review, but this parity audit remains **blocked pending fresh automated validation** because the local dependency/tooling environment prevented the required command suite from completing.
