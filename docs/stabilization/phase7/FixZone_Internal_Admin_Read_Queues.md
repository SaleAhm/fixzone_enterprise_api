# FixZone Internal Admin Read Queues

Date: 2026-08-29

## Endpoint inventory

The internal access governance read queues live under the existing protected `/api/internal-admin` namespace:

- `GET /api/internal-admin/invitations`
- `GET /api/internal-admin/invitations/:id`
- `GET /api/internal-admin/privileged-approvals`
- `GET /api/internal-admin/privileged-approvals/:id`

No new database table or migration is required. The contract reuses `Invitation`, `PrivilegedApprovalRequest`, `InternalRoleAssignment`, `User`, and `ComplianceAuditLog`.

## Pagination and filters

List endpoints return:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 25,
  "total": 0,
  "totalPages": 1
}
```

Common filters:

- `page`: integer, minimum `1`
- `pageSize`: integer, `1` to `100`
- `sortBy`: allow-listed values only
- `sortDirection`: `asc` or `desc`
- `createdFrom` / `createdTo`: ISO date strings
- `expiryState`: `active`, `expired`, or `all`
- `search`: bounded safe search

Invitation filters:

- `status`
- `role`
- `scopeType`
- `organizationId`
- `moduleKey`
- `inviterId`

Approval filters:

- `status`
- `operationType`
- `requesterId`
- `targetUserId`
- `organizationId`
- `canDecide`
- `attention`

Sorting remains deterministic with an ID or requested-time tie breaker.

## Authorization matrix

- Invitation list/detail requires `internal_admin.read`.
- Invitation visibility is limited to platform scope or matching organization scope.
- Approval queue visibility is granted by platform super admin, `internal_admin.view_audit`, or the effective permission required by each high-risk operation.
- Finance users only see payment-related approval categories when their effective permissions include the matching operation permission.
- Decision eligibility is reported separately from visibility.
- Self-approval is always reported as prohibited.
- Suspended users resolve to empty effective permissions and are denied.

## Safe response behavior

Invitation responses include recipient name, masked email, role, status, derived availability, scope, safe inviter summary, dates, MFA readiness, and stable localization metadata.

Approval responses include request ID, operation type, safe requester/approver summaries, requested role/scope, sanitized reason, status, decision eligibility, self-approval conflict, approval counts, and execution state.

The APIs never select or return:

- `inviteCode`
- `tokenHash`
- `temporaryPasswordHash`
- raw secret-bearing metadata
- Paystack secrets, webhook secrets, authorization codes, or gateway credentials
- IP address or device/user-agent details in queue payloads

## State derivation

Pending invitations with past `expiresAt` are returned as `EXPIRED` with `reasonCode: "expired"` without mutating the row.

Privileged approval execution states are conservative:

- `PENDING`: request is pending
- `BLOCKED`: decision or operation is recorded but executable workflow is not implemented
- `NOT_APPLICABLE`: rejected or cancelled request

No approval is represented as executed unless a future executable workflow records that fact.

## Audit behavior

Successful queue reads do not create noisy compliance logs. Denied visibility, scope bypass, and sensitive detail denials are audited through `Internal Admin Privilege Denied` with sanitized reason codes.

## Organization scope checkpoint

Date: 2026-08-30

Guided local UAT found an organization-scope authorization defect: an organization-scoped internal administrator with an effective organization constraint could add `scopeType=PLATFORM` to the invitation list query and receive platform invitation records. This violated scope isolation because client filters were able to widen the authorized scope instead of only narrowing it.

Root cause: the queue scope helpers treated any effective platform scope as sufficient for broad queue visibility, even when the same actor also carried an organization-bound internal assignment and organization identity. List query construction also allowed client-provided organization filters to replace, rather than combine with, the authorized organization scope.

Correction: invitation and approval list queries now combine authorized scope and client filters with an `AND` constraint. Organization-constrained internal users cannot use `scopeType=PLATFORM` or arbitrary `organizationId` parameters to disclose platform or other-organization records. Invitation and approval detail checks now use the same actor-aware platform-scope decision, while platform super administrators retain legitimate platform visibility.

Security impact: before correction, platform invitation metadata that was otherwise sanitized could be disclosed to an organization-scoped internal administrator through queue counts and list payloads. After correction, pagination totals are calculated from the constrained query and do not include hidden records.

Regression coverage now includes:

- organization-scoped internal reader without filters sees only authorized organization records;
- matching organization filter narrows within the authorized scope;
- `scopeType=PLATFORM` returns no platform records for organization-constrained readers and records a sanitized denied-scope audit event;
- another `organizationId` returns no disclosure;
- out-of-scope invitation detail remains denied;
- organization-scoped approval list cannot widen scope;
- out-of-scope approval detail remains denied;
- platform super administrators retain platform invitation visibility;
- secret-bearing invitation fields remain absent from queue payloads.

Local checkpoint observation: `npm ci`, `npx prisma validate`, `npm run build`, focused internal-admin Jest, focused demo-environment e2e, full backend Jest, full backend e2e, static security-rule checks, changed-file ESLint, `git diff --check`, and internal-admin fixture verification passed locally on 2026-08-30. The focused internal-admin suites covered 32 passing tests, the focused demo-environment e2e covered 4 passing tests, the full backend Jest run covered 176 passing tests, and the full backend e2e run covered 112 passing tests.

Lint disposition: changed-file ESLint passed with zero warnings for `src/internal-admin/internal-admin.service.ts`, `src/internal-admin/internal-admin.service.spec.ts`, `src/demo-data/demo-data.service.ts`, and `test/demo-environment.e2e-spec.ts` after Prisma Client generation. Repository-wide lint still has a pre-existing broad backlog outside this focused security tranche: `npm run lint` exits non-zero with 555 problems, 432 errors and 123 warnings. This checkpoint does not widen into whole-repository lint remediation.

E2E cleanup diagnosis: `test/demo-environment.e2e-spec.ts` previously failed on `InternalRoleAssignment_assignedById_fkey` because broad `isDemo=true` cleanup collided with the retained `internal-admin-uat-20260829-v1` fixture batch. The referenced internal role assignments were owned by that retained UAT batch, with UAT users appearing as both assignment subjects and assigners.

E2E cleanup correction: demo-environment preview, statistics, purge, and e2e cleanup now scope owned records to the deterministic `demo-` batch prefix. Demo-environment cleanup deletes internal role assignments that reference demo-environment users through either `userId` or `assignedById` before deleting those users, remains idempotent, and does not touch the retained internal-admin UAT batch. Production foreign-key semantics were preserved; `assignedById` remains restrictive and no broad cascade schema change was made.

Dependency audit observation: `npm audit --omit=dev` reports the accepted production baseline of 22 vulnerabilities with zero critical findings, and full `npm audit` reports the accepted baseline of 32 vulnerabilities with zero critical findings. `websocket-driver` remains present at `0.7.5` through `firebase-admin`.

Remaining UAT requirement: rerun the authenticated browser navigation pass after the backend checkpoint, including refresh, back/forward behavior, responsive layouts, Arabic RTL, one additional locale, keyboard focus, and detail dialog behavior without capturing credentials or tokens.

## Frontend integration notes

The committed localized Admin & Access Management frontend can replace its queue-unavailable panels with:

- `ApiService.getInternalInvitations(query)`
- `ApiService.getInternalInvitation(id)`
- `ApiService.getPrivilegedApprovals(query)`
- `ApiService.getPrivilegedApproval(id)`

The frontend must continue to treat `canDecide`, `decisionProhibitedReason`, `executionBlocked`, and `executionState` as backend authority.

## Guided UAT checklist

- Super Admin can list and open internal invitations.
- Organization-scoped internal reader cannot view another organization invitation.
- Expired pending invitation displays as expired without mutation.
- Finance-limited user sees only payment-operation approvals for assigned permissions.
- Requester sees self-approval conflict and cannot decide their own request.
- Independent approver with matching permission sees `canDecide: true`.
- Blocked approvals never display as executed.
- Queue payloads do not include tokens, hashes, secrets, raw Paystack credentials, IP addresses, or user-agent values.

## Known limitations

- No high-risk operation execution is implemented in this tranche.
- Approval expiry is not modeled in the current schema, so expiry filters are reserved for forward compatibility.
- MFA enforcement and active token-version invalidation remain outside this tranche.
