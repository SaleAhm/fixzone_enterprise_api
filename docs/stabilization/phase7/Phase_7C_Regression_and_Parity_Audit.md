# Phase 7C Regression and Parity Audit

Date: 2026-07-17

## Scope

This audit reviewed frontend/backend parity and regression risk for invitations, report discussions, Trust Center enforcement settings, notifications, organization context, and cross-role workflows. It is documentation-only; no runtime implementation changes were made.

## Frontend/Backend Contract Review

| Feature | Flutter API | Backend route | Method | Status |
| --- | --- | --- | --- | --- |
| Admin invitation creation | `ApiService.createAdminInvitation` | `/api/users/admin/invitations` | POST | Implemented; body is dynamic and backend validates role/email/phone/org scope. |
| Admin invitation list | `ApiService.getAdminInvitations` | `/api/users/admin/invitations` | GET | Implemented; returns serialized invitation with organization/inviter/accepted user. |
| Invitee invitation list | `ApiService.getMyInvitations` | `/api/users/invitations/mine` | GET | Implemented; filters by current user email/phone. |
| Invitation accept | `ApiService.acceptInvitation` | `/api/users/invitations/:id/accept` | POST | Implemented; updates user membership and provider link where applicable. |
| Invitation decline | `ApiService.declineInvitation` | `/api/users/invitations/:id/decline` | POST | Implemented; marks `DECLINED`. |
| Invitation resend | `ApiService.resendAdminInvitation` | `/api/users/admin/invitations/:id/resend` | POST | Implemented; records reminder and in-app notification. |
| Invitation revoke | `ApiService.revokeAdminInvitation` | `/api/users/admin/invitations/:id/revoke` | POST | Implemented; marks `REVOKED` and notifies invitee if user exists. |
| Report-message list | `ApiService.getReportMessages` | `/api/report/:id/messages` | GET | Implemented; returns ordered messages. |
| Report-message create | `ApiService.createReportMessage` | `/api/report/:id/messages` | POST | Implemented; body `{ message }`, max 1200 chars. |
| Trust enforcement read | `ApiService.getTrustEnforcementSettings` | `/api/admin/trust/enforcement-settings` | GET | Implemented. |
| Trust enforcement update | `ApiService.updateTrustEnforcementSettings` | `/api/admin/trust/enforcement-settings` | POST | Implemented; Flutter allow-lists expected keys. |
| Notifications list | `ApiService.getNotifications` | `/api/notifications` | GET | Implemented. |
| Notification unread count | `ApiService.getUnreadNotificationCount` | `/api/notifications/unread-count` | GET | Implemented. |
| Mark notification read | `ApiService.markNotificationRead` | `/api/notifications/:id/read` | PATCH | Implemented. |
| Mark all read | `ApiService.markAllNotificationsRead` | `/api/notifications/read-all` | PATCH | Implemented. |
| Organization context | `ApiService.getMyOrganization` | `/api/organizations/mine` | GET | Implemented, but not uniformly surfaced in all shells. |

### Contract Risks

- Flutter still surfaces some caught errors as raw exception text in SnackBars, including invitation action failures and discussion send failures.
- Invitation creation uses `Record<string, unknown>` server-side instead of a strongly typed DTO, so validation shape is service-driven rather than class-validator driven.
- No pagination contract exists for invitations or report messages; server currently caps admin invitations at 100 and messages are unpaginated.
- Report discussion rendering uses Flutter `Text`, which is safe from HTML injection, but no rich-text sanitizer is needed only because content is rendered as plain text.
- Trust enforcement mismatch previously fixed remains aligned: Flutter sends only `requireVerifiedIdentityForDisputes`, `requireVerifiedIdentityForProviderJobAcceptance`, `requireVerifiedIdentityForEvidenceUpload`, `requireEntitlementPlanForPriorityWorkflows`, and `requiredPriorityPlan`, matching backend DTO intent.

## Invitation Lifecycle Readiness

| Requirement | Status | Evidence |
| --- | --- | --- |
| Admin creates invitation | Implemented | `UsersService.inviteUser` persists `Invitation` with `PENDING`, token hash, expiry, invite code. |
| Invitation persisted | Implemented | Prisma `Invitation` model stores status, expiry, organization, invitedBy, acceptedUser, timestamps. |
| Invitee can see invitation | Implemented | `/users/invitations/mine` filters by email/phone and excludes expired pending invites. |
| Organization name shown | Implemented | Serialized invitation includes `organization.name`; Flutter panel displays it. |
| Intended role shown | Implemented | Serialized `role`; Flutter labels it. |
| Accept | Implemented | Updates user role/org, creates provider organization link when role is provider, marks accepted. |
| Decline | Implemented | Marks `DECLINED` and notifies inviter. |
| Resend | Implemented | Updates `resentAt`, `lastNotificationAt`, metadata resend count. |
| Revoke | Implemented | Marks `REVOKED` and notifies invitee if matched user exists. |
| Duplicate active invitation | Implemented | Pending duplicate check on role/org/email/phone/expiry. |
| Existing-member handling | Implemented | Throws conflict for existing active member with same org and role. |
| Expired invitation | Implemented | Expired pending invitations are marked `EXPIRED` on retrieval/action. |
| Cross-org isolation | Partially verified by code | Org admins scoped by `organizationId`; fresh e2e rerun blocked. |
| Unauthorized role grant prevention | Implemented | Super admin invitations disallowed; org admins cannot invite org admins. |
| Audit/activity creation | Implemented | Uses `DemoAuditLog` for invitation actions. |
| Notification creation | Implemented | In-app notification rows are created for invitee/inviter events. |

Readiness split:

- In-app invitation readiness: implemented, pending fresh backend e2e rerun.
- Email invitation readiness: configuration-pending; code states email delivery is not configured.
- Token-link invitation readiness: partial foundation only; token hash exists, but no verified email link delivery flow.
- Remaining limitations: no production email transport, no bounce/retry tracking, no delivery confirmation, no pagination.

The old temporary-password invitation workflow is no longer the default for new admin invitations. Legacy user resend/reset paths still exist and are labelled as legacy/manual.

## Report Discussion Security Review

Backend uses `getReportById(reportId, user)` before listing or creating report messages. That check allows:

- Super admin.
- Report citizen.
- Assigned provider.
- Organization admin or dispatch officer in the same organization.

It rejects unrelated citizens, unrelated providers, users outside organization scope, and unauthenticated requests through guards. Existing tests include report discussion participant scoping, but required fresh rerun was blocked by backend dependency failure.

Controls present:

- Message must be non-empty.
- Message is trimmed.
- Max length is 1200 characters.
- Messages are report-scoped and organizationId-scoped.
- Sender id, role, and display name are persisted.
- Report activity `REPORT_DISCUSSION_MESSAGE` is recorded.
- Participant notifications are created for report citizen, assigned provider, and active org operators except the sender.
- Flutter labels the UI as "Report Discussion" and uses manual refresh after send, not real-time chat.

Limitations:

- No pagination.
- No edit/delete/moderation workflow.
- No server-side profanity/content moderation.
- No real-time push; manual refresh/poll-like reload only.

## Notification Readiness Review

| Notification type | In-app persistence | Navigation/readiness |
| --- | --- | --- |
| Invitation received | Implemented for existing matched user | No email/push/SMS verified. |
| Invitation accepted | Implemented to inviter | Generic notification navigation may not deep-link to invitation admin panel. |
| Invitation declined | Implemented to inviter | Same navigation limitation. |
| Invitation revoked | Implemented to invitee if matched user exists | Same navigation limitation. |
| Report assignment | Implemented in report workflow | Provider notification tests passed in Flutter. |
| Provider progress | Implemented in workflow paths | Production-unverified. |
| Evidence submission | Implemented in report/evidence paths | Production-unverified. |
| Completion review | Implemented; Flutter notification navigation tests passed | Locally verified in Flutter tests. |
| Dispute activity | Implemented in Trust dispute workflow | Production-unverified. |
| Report discussion message | Implemented | Deep link target is report detail/job detail via reportId. |

In-app persisted notification readiness is partial. Email, push, and SMS delivery are not production verified and must not be claimed as complete. Mark-as-read and mark-all-read APIs exist. Duplicate notification prevention is limited; discussion messages intentionally fan out per message.

Previously reported notification back-navigation risk is improved by Flutter notification navigation tests, but production manual smoke testing remains required.

## Organization and Workspace Context

| Role shell | Status | Finding |
| --- | --- | --- |
| Organization Admin | Partially complete | Admin dashboard still has fallback text like "Welcome, Organization Administrator" and does not always show organization identity prominently. |
| Dispatch Officer | Partially complete | Backend provides org scope; UI context should be hardened in next tranche. |
| Provider | Mostly complete | Provider dashboard/profile expose `displayOrganization`. |
| Citizen | Partially complete | Citizen profile can show organization service area; shell context is lighter. |
| Super Admin | Partially complete | Platform scope exists but should be clearer in enterprise shell headers. |

Current APIs can provide organization name through `/organizations/mine`, user organization relation in admin user select, and provider profile data. This is not blocked by API data; it is a UI hardening gap.

Recommended next tranche files:

- `lib/features/admin/presentation/screens/admin_dashboard_screen.dart`
- `lib/features/admin/presentation/screens/admin_home_shell.dart`
- `lib/features/citizen/presentation/screens/citizen_home_screen.dart`
- `lib/features/provider/presentation/screens/provider_dashboard_screen.dart`
- `lib/core/services/api_service.dart`

## Regression Matrix

| Workflow | Audit status |
| --- | --- |
| Citizen OTP login | Existing implementation; fresh backend e2e blocked. |
| Provider login | Existing implementation; Flutter tests cover provider state/navigation; backend rerun blocked. |
| Organization admin login | Existing implementation; backend rerun blocked. |
| Super admin login | Existing implementation; backend rerun blocked. |
| Citizen report submission | Existing implementation; backend rerun blocked. |
| Duplicate-report handling | Existing implementation; backend rerun blocked. |
| Assignment and AI-assisted assignment | Existing implementation; backend rerun blocked. |
| Provider acceptance/progress/evidence/completion | Flutter assignment/evidence tests present; backend rerun blocked. |
| Citizen review, rating, closure | Existing implementation; backend rerun blocked. |
| Disputes and records | Trust implementation present; backend rerun blocked. |
| Subscriptions/monetization | Manual billing UI truthfulness tests passed in Flutter. |
| Analytics and Trust Center | Flutter routes/tests pass; backend rerun blocked. |
| Invitations | Implemented; backend rerun blocked. |
| Report discussion | Implemented; backend rerun blocked. |
| Notifications | Flutter navigation tests passed; backend rerun blocked. |
| Responsive navigation/onboarding | Flutter tests passed. |

Do not claim email authentication, payment gateway, GIS production operation, real-time chat, or production invitation email delivery.
