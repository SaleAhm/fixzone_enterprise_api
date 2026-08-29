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
