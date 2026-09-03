# Phase 2 API Compatibility Report

Date: 2026-07-09

## Purpose

This report defines API compatibility expectations before Phase 2 implementation begins. It is documentation-only and does not authorize code changes, package installation, migrations, pushes, merges, deployments, or service restarts.

## Existing API Baseline References

- Active production module: Maintenance/FixZone.
- Stable backend prefix: `/api`.
- Stable source-of-truth workflow: existing `Report` APIs and data model.
- Stable evidence references: existing `/uploads/...` file URLs must remain readable during any transition.
- Phase 1 runtime hardening baseline:
  - enterprise rate limiting;
  - strict evidence upload validation;
  - safer static upload serving headers.
- Phase 2 planning baseline:
  - `Phase_2_Entry_Governance_Review.md`;
  - `Phase_2_Implementation_Roadmap.md`;
  - `Phase_2_Execution_Preparation_Checklist.md`;
  - `Phase_2_Runtime_Impact_Assessment.md`.

## Public Endpoint Inventory

Public means externally consumed by unauthenticated users, authenticated mobile/web users, or public operational checks. These endpoints require the strongest compatibility discipline because mobile and web clients may depend on their current route shape and response contracts.

Unauthenticated or low-friction entry points:

- `GET /api`
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/firebase-login`
- `POST /api/onboarding/citizen/register`
- `POST /api/onboarding/provider/request-access`
- `POST /api/onboarding/organization/register`
- `GET /api/platform-tools/maintenance/public`

`POST /api/auth/register` is a public citizen-only compatibility path. Requests must omit `role`; any supplied role value is denied, and successful registrations receive the server-assigned `CITIZEN` role. Provider access requests, organization owner onboarding, internal administrator delegation, and seeded/bootstrap accounts use their separate guarded or purpose-specific workflows.

Authenticated client and provider endpoints:

- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PATCH /api/notifications/read-all`
- `PATCH /api/notifications/:id/read`
- `POST /api/report`
- `GET /api/report/my`
- `GET /api/report/citizen/my`
- `GET /api/report/citizen/dashboard/summary`
- `GET /api/report/assigned`
- `GET /api/report/:id`
- `GET /api/report/:id/timeline`
- `PATCH /api/report/:id/status`
- `POST /api/report/:id/evidence`
- `POST /api/report/:id/completion-evidence`
- `POST /api/report/provider/:id/reject`
- `POST /api/report/:id/reject-assignment`
- `PATCH /api/report/:id/reject-assignment`
- `GET /api/report/citizen/:id/completion-review`
- `POST /api/report/citizen/:id/confirm-completion`
- `POST /api/report/citizen/:id/reject-completion`
- `PATCH /api/report/:id/citizen-confirm`
- `PATCH /api/report/:id/citizen-reject`
- `GET /api/identity/me`
- `POST /api/identity/kyc/submit`
- `GET /api/identity/kyc/my-submissions`
- `POST /api/disputes`
- `GET /api/disputes/my`
- `GET /api/disputes/:id`
- `POST /api/disputes/:id/message`
- `POST /api/records/evidence`
- `GET /api/records/evidence`
- `GET /api/records/evidence/:id`
- `GET /api/entitlements/me`
- `GET /api/security/me/login-history`

## Internal Endpoint Inventory

Internal means admin, operational, platform governance, framework metadata, or future-module readiness surfaces. These may still be consumed by trusted web/mobile admin clients, so changes must remain intentional and tested.

Admin and organization management:

- `GET /api/auth/admin-only`
- `GET /api/auth/provider-or-admin`
- `POST /api/organizations`
- `GET /api/organizations`
- `GET /api/organizations/mine`
- `GET /api/organizations/billing/overview`
- `GET /api/organizations/:id`
- `PATCH /api/organizations/:id`
- `POST /api/organizations/:id/activate`
- `POST /api/organizations/:id/suspend`
- `DELETE /api/organizations/:id`
- `GET /api/organizations/:id/users`
- `GET /api/organizations/:id/providers`
- `GET /api/organizations/:id/reports`
- `GET /api/organizations/:id/billing`
- `GET /api/users/admin`
- `GET /api/users/admin/recent`
- `GET /api/users/admin/invitations`
- `POST /api/users/admin/invitations`
- `POST /api/users/admin/invitations/:id/revoke`
- `GET /api/users/admin/:id`
- `PATCH /api/users/admin/:id`
- `PATCH /api/users/admin/:id/suspend`
- `PATCH /api/users/admin/:id/activate`
- `POST /api/users/admin/:id/reset-password`
- `POST /api/users/admin/:id/resend-invitation`
- `POST /api/users/admin/:id/approve-provider`
- `POST /api/users/admin/:id/reject-provider`

Admin report operations:

- `GET /api/report`
- `GET /api/report/admin/dashboard/summary`
- `GET /api/report/admin/dashboard/trends`
- `GET /api/report/admin/dashboard/category-trends`
- `GET /api/report/admin/dashboard/provider-performance`
- `GET /api/report/admin/dashboard/advanced`
- `GET /api/report/admin/dashboard/recent`
- `PATCH /api/report/:id/assign`
- `POST /api/report/admin/assignments/expire-overdue`
- `POST /api/report/:id/cancel-assignment`
- `PATCH /api/report/:id/reassign`
- `PATCH /api/report/:id/recommend-provider`
- `PATCH /api/report/:id/auto-assign`

Trust, identity, and dispute administration:

- `GET /api/admin/identity/kyc-submissions`
- `POST /api/admin/identity/kyc-submissions/:id/review`
- `GET /api/admin/audit/compliance`
- `GET /api/admin/trust/summary`
- `GET /api/admin/trust/enforcement-settings`
- `POST /api/admin/trust/enforcement-settings`
- `GET /api/admin/disputes`
- `POST /api/admin/disputes/:id/status`
- `POST /api/admin/disputes/:id/assign`
- `POST /api/admin/disputes/:id/escalate`
- `POST /api/admin/disputes/escalate-overdue`

Platform and enterprise framework:

- `GET /api/platform/config`
- `GET /api/platform/provider-capabilities`
- `GET /api/platform/analytics-contracts`
- `GET /api/platform/readiness`
- `GET /api/platform/health-summary`
- `GET /api/platform/rollout-governance`
- `GET /api/platform/module-readiness/:moduleKey`
- `GET /api/platform/module-activation-governance/:moduleKey`
- `GET /api/platform/readiness/:organizationId`
- `GET /api/platform/configuration-validation/:organizationId`
- `GET /api/platform/audit-history`
- `GET /api/platform/service-configuration`
- `GET /api/platform/service-configuration/:organizationId`
- `PATCH /api/platform/service-configuration/:organizationId`
- `GET /api/platform/providers/:providerId/capabilities`
- `POST /api/platform/providers/:providerId/capabilities`
- `PATCH /api/platform/providers/:providerId/capabilities/:capabilityId/inactive`
- `DELETE /api/platform/providers/:providerId/capabilities/:capabilityId`
- `GET /api/platform-modules`
- `GET /api/platform-modules/access-profile`
- `GET /api/platform-modules/access/:moduleKey`
- `GET /api/enterprise-services`
- `GET /api/enterprise-services/definitions`
- `GET /api/enterprise-services/provider-capabilities`
- `GET /api/enterprise-services/maintenance/registration`
- `GET /api/business-logic/workflow-engine`

Operational tools and demo data:

- `GET /api/platform-tools/health`
- `POST /api/platform-tools/backups`
- `GET /api/platform-tools/backups`
- `GET /api/platform-tools/backups/:id/download`
- `POST /api/platform-tools/backups/:id/restore`
- `DELETE /api/platform-tools/backups/:id`
- `GET /api/platform-tools/maintenance`
- `POST /api/platform-tools/maintenance`
- `GET /api/platform-tools/cache`
- `POST /api/platform-tools/cache/clear`
- `GET /api/platform-tools/audit`
- `GET /api/platform-tools/audit/export`
- `GET /api/admin/platform-tools/demo-environment/statistics`
- `POST /api/admin/platform-tools/demo-environment/generate`
- `POST /api/admin/platform-tools/demo-environment/reset`
- `DELETE /api/admin/platform-tools/demo-environment/purge`
- `POST /api/admin/demo-data/seed`
- `DELETE /api/admin/demo-data/purge`

## DTO Compatibility Requirements

- Keep existing required request fields valid for Phase 2 unless a versioned replacement is approved.
- Additive optional DTO fields are preferred.
- Do not remove or rename request fields used by mobile, web, admin, provider, or citizen clients.
- Do not change enum casing or accepted legacy aliases without a compatibility adapter.
- Preserve existing upload DTO shape for evidence uploads unless a versioned upload contract is introduced.
- Preserve response keys for report status, evidence paths, notification payloads, organization summaries, and platform metadata.
- Validation errors should remain JSON and actionable.
- New validation rules must be documented with expected client remediation.

## Versioning Strategy Recommendations

- Keep `/api` as the current stable route prefix.
- Use additive endpoint expansion for Phase 2 where possible.
- Introduce `/api/v2/...` only for intentionally breaking request or response contracts.
- Prefer route-specific versioning over global API versioning until a broad compatibility strategy is approved.
- Keep Maintenance/FixZone routes unversioned and stable unless a formal client migration plan exists.
- For protected evidence delivery, consider adding new routes while preserving existing `/uploads/...` compatibility.
- Document deprecation timelines before removing any field or route.

## Backward Compatibility Requirements

- Existing Maintenance/FixZone client workflows must continue to work.
- Existing evidence URLs and saved evidence paths must remain resolvable.
- Existing report status transitions must remain compatible.
- Existing auth token claims and role interpretation must remain compatible.
- Existing notification read/unread flows must remain compatible.
- Existing admin dashboards must continue to receive expected summary, trend, recent report, and provider performance shapes.
- Existing future-module metadata endpoints must not imply production activation.
- Rate-limit and upload validation errors must not break client JSON error handling.

## Breaking-Change Classification Matrix

| Change Type | Classification | Phase 2 Guidance |
| --- | --- | --- |
| Add optional request field | Non-breaking | Allowed with tests |
| Add response field | Non-breaking | Allowed if clients can ignore it |
| Add new endpoint | Non-breaking | Allowed if authenticated and documented |
| Tighten validation on existing field | Potentially breaking | Requires client impact review |
| Change response field type | Breaking | Requires versioning |
| Rename request or response field | Breaking | Requires versioning and migration plan |
| Remove endpoint | Breaking | Out of scope without deprecation plan |
| Remove accepted enum value or alias | Breaking | Requires compatibility adapter |
| Change authentication requirement | Breaking or high-risk | Requires security and client review |
| Change RBAC behavior | Breaking or high-risk | Requires role matrix testing |
| Change rate-limit profile | Potentially breaking | Requires observability and staged rollout |
| Change evidence URL behavior | Breaking or high-risk | Requires compatibility path |

## Authentication Compatibility Considerations

- Existing JWT bearer token handling must remain stable.
- Existing Firebase login behavior must remain stable.
- Existing role claims for citizen, provider, org admin, and super admin must remain compatible.
- New guards should not block existing Maintenance endpoints by default.
- Module entitlement checks must layer on top of existing RBAC without weakening it.
- Unauthenticated endpoints must remain limited to explicit public entry points.
- Auth error responses should remain consistent enough for current clients to handle.

## Frontend and Mobile Client Compatibility Considerations

- Flutter clients must not be forced to change existing report, evidence, notification, auth, or dashboard request shapes during Phase 2 unless a versioned migration is approved.
- Existing mobile upload flows must receive clear errors for rejected files.
- Existing `/uploads/...` image rendering must remain supported during evidence delivery transition.
- Admin navigation can consume new metadata only if Maintenance remains visible and usable.
- Provider job assignment, rejection, completion evidence, and status flows require regression coverage after any API change.
- Citizen report creation, evidence upload, completion review, and notification flows require regression coverage after any API change.
- Website API dependencies should remain isolated from backend runtime changes unless explicitly scoped.

## Validation and Regression Requirements

Backend:

- `npx prisma validate`
- `npx prisma generate`
- `npm run build`
- `npm test -- --runInBand`
- `npm run test:e2e -- --runInBand`

Frontend:

- `flutter analyze`
- `flutter test`
- `flutter build web --release`

Website:

- `npm run build`
- `npm run typecheck`
- `npm run lint`

API-specific regression requirements:

- Auth login, Firebase login, and `me` profile flows.
- Citizen report creation, evidence upload, report list, and completion review.
- Provider assignment, rejection, status update, and completion evidence flows.
- Admin report dashboards and assignment operations.
- Notification read/unread flows.
- Trust, KYC, dispute, and evidence record access.
- Platform module access states: `allowed`, `locked`, `hidden`.
- Cross-tenant access denial for reports, evidence, users, organizations, and trust records.
- Rate-limit expected `429` behavior and normal authorized flow behavior.

## Recommended API Governance Rules for Phase 2

- Treat existing Maintenance/FixZone APIs as stable public contracts.
- Prefer additive changes over mutations to existing contracts.
- Require an API compatibility note for every Phase 2 tranche that touches controllers, DTOs, guards, interceptors, upload delivery, or auth behavior.
- Require client-impact review before tightening validation or changing error responses.
- Require versioning for any breaking route, DTO, or response change.
- Keep future module endpoints read-only or metadata-only until activation is separately approved.
- Preserve tenant isolation and RBAC as blocking validation gates.
- Keep rate-limit and upload behavior observable before production rollout.
- Do not remove legacy evidence URL compatibility until protected delivery is proven and client migration is complete.

## Implementation Hold

This report does not start Phase 2 implementation. API changes should begin only after the selected tranche has approval, a compatibility note, a validation plan, and rollback steps.
