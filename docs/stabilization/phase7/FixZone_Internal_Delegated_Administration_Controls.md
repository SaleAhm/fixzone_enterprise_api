# FixZone Internal Delegated Administration Controls

## Baseline

This local-only backend tranche starts from `4fc3eeb7f4a2d37c2fcf6c81404ae9580b1b74b8` on `main`, with production release scripting left untracked and untouched. It does not push, deploy, restart services, access production, or apply production migrations.

Existing foundations discovered:

- `UserRole` already separated customer roles (`ORG_ADMIN`, `DISPATCH_OFFICER`, `PROVIDER`, `CITIZEN`) from platform roles.
- `Permission`, `RolePermission`, `AdminScope` and `DelegatedAuthority` existed as an early governance foundation.
- `Invitation` already supported expiring, single-use invited identities.
- `ComplianceAuditLog` and `Notification` supported durable event records.
- Paystack subscription initialization, verification, webhook processing and reconciliation existed from the previous tranche, but reconciliation was guarded by broad super-admin role checks.

## Internal Role Catalogue

Canonical predefined roles are exposed through `GET /api/internal-admin/roles`. No arbitrary permission editor is exposed.

| Canonical role                  | Existing equivalent                  | Notes                                                         |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `PLATFORM_SUPER_ADMIN`          | `SUPER_ADMIN`                        | Full platform permissions; grants require dual approval.      |
| `OPERATIONS_ADMIN`              | `ASSIGNMENT_ADMIN` capability family | Report operations and routing readiness.                      |
| `ORGANIZATION_ONBOARDING_ADMIN` | none                                 | Organization review and management.                           |
| `PROVIDER_ADMIN`                | none                                 | Provider review and management.                               |
| `FINANCE_BILLING_ADMIN`         | `BILLING_ADMIN`                      | Payment read, reconciliation and refund request.              |
| `SUPPORT_ADMIN`                 | `SUPPORT_ADMIN`                      | Account assistance only.                                      |
| `COMPLIANCE_AUDIT_ADMIN`        | `COMPLIANCE_ADMIN`                   | Audit read and audit workspace access.                        |
| `SECURITY_ADMIN`                | none                                 | Session governance and privileged security review.            |
| `INVESTIGATION_ADMIN`           | none                                 | Disabled unless investigation feature flags are enabled.      |
| `ASSET_INTELLIGENCE_ADMIN`      | `ASSET_ADMIN`                        | Disabled unless asset intelligence feature flags are enabled. |
| `RELEASE_OPERATIONS_ADMIN`      | none                                 | Release readiness evidence, not deployment.                   |
| `BACKUP_RECOVERY_ADMIN`         | none                                 | Backup verification and restore requests only.                |

## Permission Matrix

Permissions are stable string keys grouped by domain:

- Internal admin: `internal_admin.read`, `internal_admin.invite`, `internal_admin.assign_role`, `internal_admin.change_scope`, `internal_admin.suspend`, `internal_admin.revoke_sessions`, `internal_admin.view_audit`
- Organization/provider/report: `organization.review`, `organization.manage`, `provider.review`, `provider.manage`, `report.operations`
- Support/compliance/security: `support.account_assistance`, `compliance.audit_read`, `security.session_manage`
- Disabled enterprise foundations: `investigation.manage`, `asset_intelligence.manage`
- Release/backup: `release.readiness_manage`, `backup.verify`, `backup.restore_request`
- Payments: `payment.plan_read`, `payment.plan_manage`, `payment.transaction_read`, `payment.reconciliation_manage`, `payment.refund_request`, `payment.refund_approve`, `payment.configuration_manage`

The server calculates effective permissions from the user's predefined role plus active, unexpired `InternalRoleAssignment` rows. Suspended users and expired or revoked assignments contribute no effective permissions.

## Scope Model

`InternalRoleAssignment` supports:

- `PLATFORM`
- `MODULE`
- `ORGANIZATION`
- `JURISDICTION`

Assignments persist status, start time, optional expiry, assigning administrator, reason, revocation metadata, permission snapshot and role-definition version. Client identifiers cannot widen scope beyond the acting administrator's organization when the actor is organization-scoped.

## Administrator Lifecycle

Implemented backend APIs:

- `GET /api/internal-admin/roles`
- `GET /api/internal-admin/administrators`
- `GET /api/internal-admin/administrators/:id/effective-access`
- `POST /api/internal-admin/invitations`
- `POST /api/internal-admin/invitations/:id/accept`
- `POST /api/internal-admin/administrators/:id/roles`
- `PATCH /api/internal-admin/role-assignments/:id/remove`
- `PATCH /api/internal-admin/administrators/:id/suspend`
- `PATCH /api/internal-admin/administrators/:id/reactivate`
- `POST /api/internal-admin/administrators/:id/revoke-sessions`
- `GET /api/internal-admin/administrators/:id/role-history`
- `POST /api/internal-admin/privileged-approvals`
- `POST /api/internal-admin/privileged-approvals/:id/decision`

MFA is part of the contract but not falsely claimed as enforced. Responses expose `blocked_until_mfa_foundation`.

## Privileged Approval Matrix

High-risk actions are persisted in `PrivilegedApprovalRequest` with execution blocked:

| Operation                          | Permission required            | Execution state                                  |
| ---------------------------------- | ------------------------------ | ------------------------------------------------ |
| `PLATFORM_SUPER_ADMIN_GRANT`       | `internal_admin.assign_role`   | Pending or decision recorded; execution blocked. |
| `ROLE_DEFINITION_CHANGE`           | `internal_admin.assign_role`   | Execution blocked.                               |
| `PRODUCTION_RESTORE_AUTHORIZATION` | `backup.restore_request`       | Execution blocked.                               |
| `ENTERPRISE_FEATURE_ENABLEMENT`    | `release.readiness_manage`     | Execution blocked.                               |
| `PAYMENT_CONFIGURATION_CHANGE`     | `payment.configuration_manage` | Execution blocked.                               |
| `HIGH_VALUE_REFUND_APPROVAL`       | `payment.refund_approve`       | Execution blocked.                               |

The requester cannot approve their own request.

## Paystack Segregation Of Duties

Payments now consume explicit internal-admin permissions:

- Organization admins and organization billing admins can read and initialize billing only for their own organization.
- `FINANCE_BILLING_ADMIN` can read payment transactions and run reconciliation through `payment.transaction_read` and `payment.reconciliation_manage`.
- Payment configuration changes, plan management and refund approval are separate permission keys and are not implemented as executable actions in this tranche.
- Refund request and refund approval are separate permissions; one-person request/approval execution remains blocked pending a refund workflow.
- Paystack secrets, raw webhook signatures, provider access tokens and raw authorization payloads are not returned by APIs or stored in audit metadata.

## Audit And Localization

Sanitized `ComplianceAuditLog` records are created for:

- internal administrator invitations
- invitation acceptance/expiry
- role assignment/removal
- suspension/reactivation
- session revocation request
- denied privilege escalation
- privileged approval requests and decisions
- payment authorization denial

Notifications use stable keys such as `internal_admin.invitation_created` with preferred locale and English fallback metadata in the response contract.

## Migration And Rollback

Migration `20260829203000_internal_delegated_admin_controls` is additive:

- Adds canonical internal `UserRole` enum values.
- Adds `InternalRoleAssignment` for scoped active/expired/revoked role history.
- Adds `PrivilegedApprovalRequest` for high-risk dual-control requests.

Rollback note: PostgreSQL enum value removal requires a planned replacement enum migration. Tables can be dropped only after confirming no dependent UAT/admin data must be retained.

## Limitations

- MFA is declared required but not enforced until the MFA foundation exists.
- Session revocation records a readiness event; token-version invalidation is not yet implemented.
- High-risk approval execution remains blocked. This tranche records requests and decisions only.
- No frontend Super Admin workspace is implemented.
- Investigation, asset intelligence and other enterprise foundations remain default-off unless their master and feature flags are enabled.
- No live Paystack calls or production payment configuration changes were performed.

## Frontend Contract

The later Super Admin workspace should render:

- predefined role catalogue and enabled/blocked state
- administrator list with effective roles, permissions, scopes and MFA readiness
- invitation create/accept flows
- assignment/removal history
- suspension/reactivation and session-revocation readiness states
- privileged approval queue with blocked execution language
- payment governance affordances that show finance permissions without exposing provider secrets

## Guided UAT Checklist

- Invite a finance billing administrator and verify invitation metadata.
- Accept an unexpired invitation with the intended email.
- Confirm expired invitations are rejected and audited.
- Assign and remove a scoped support/admin role.
- Confirm unrelated organization admins cannot read internal admin data.
- Confirm suspended administrators have no effective permissions.
- Confirm self-promotion and self-approval are rejected and audited.
- Confirm final active platform super-admin protection.
- Confirm finance billing admin can run payment reconciliation only through explicit permission.
- Confirm payment configuration and refund approval remain blocked without their explicit permissions and workflows.
