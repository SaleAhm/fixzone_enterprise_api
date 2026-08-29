# Internal Admin Governance UAT Fixtures

Date: 2026-08-29

## Scope

This fixture pack prepares local-only data for browser/API UAT of the Internal
Admin Access Governance queues. It does not authorize production access,
staging access, deployment, production migration, service changes, broad
database reset, production-data operations or release-script execution.

## Safety Model

The commands fail closed unless all guard conditions pass:

- `NODE_ENV` is not `production`.
- `DATABASE_URL` resolves to host `localhost` or `127.0.0.1`.
- database port is `5432`.
- database name is exactly `fixzone_enterprise`.
- schema is `public`.
- `FIXZONE_ALLOW_LOCAL_UAT_FIXTURES=true` is present.
- the fixture batch starts with `internal-admin-uat-`.
- configured public/callback/CORS host variables do not contain production-like
  FixZone/SecureZone/Dokploy domains.

The commands print only sanitized database identity and counts. They never
print passwords, tokens, invite codes, token hashes, connection strings or
payment secrets.

## Fixture Batch

Batch: `internal-admin-uat-20260829-v1`

Owned records are distinguishable by:

- user and organization `demoBatchId`;
- user and organization `demoScenario`;
- deterministic local-only email namespace:
  `internal-admin-uat-*.internal-admin-uat.local.test`;
- invitation metadata `fixtureBatch`;
- privileged approval payload `fixtureBatch`;
- internal role assignment `reason` prefix matching the batch.

No schema migration is required.

## Required Environment Variables

Use local shell/session variables or an ignored local file. Do not commit
credential values.

- `DATABASE_URL`
- `FIXZONE_ALLOW_LOCAL_UAT_FIXTURES`
- `FIXZONE_LOCAL_UAT_PASSWORD`

`FIXZONE_LOCAL_UAT_PASSWORD` must be at least 12 characters.

## Commands

Seed:

```bash
npm run uat:internal-admin:seed
```

Verify:

```bash
npm run uat:internal-admin:verify
```

Cleanup:

```bash
npm run uat:internal-admin:cleanup
```

Cleanup is intentionally separate. Do not run it before the guided browser UAT
that consumes these fixtures.

## Accounts

All accounts are local-only, deterministic, and use the shared password supplied
through `FIXZONE_LOCAL_UAT_PASSWORD`.

| Label                       | Role                    | Scope/Purpose                                             |
| --------------------------- | ----------------------- | --------------------------------------------------------- |
| `platform-super-admin`      | `PLATFORM_SUPER_ADMIN`  | Platform visibility and full queue browsing.              |
| `internal-reader`           | `SUPPORT_ADMIN`         | `internal_admin.read` platform queue read.                |
| `finance-billing-admin`     | `FINANCE_BILLING_ADMIN` | Finance approval visibility for payment/refund scenarios. |
| `org-scoped-internal-admin` | `SUPPORT_ADMIN`         | Organization-scoped internal queue read.                  |
| `ordinary-org-admin`        | `ORG_ADMIN`             | Ordinary organization admin denial check.                 |
| `suspended-internal-admin`  | `SUPPORT_ADMIN`         | Suspended-login/access denial check.                      |
| `expired-assignment-admin`  | `CITIZEN`               | Expired internal assignment denial check.                 |
| `independent-approver`      | `SUPPORT_ADMIN`         | Distinct approver for high-risk approval checks.          |
| `privileged-requester`      | `SUPPORT_ADMIN`         | Request creator and self-approval prohibition check.      |

## Invitation Scenarios

- Pending unexpired platform internal reader.
- Accepted finance/billing administrator.
- Revoked organization-scoped internal reader.
- Pending invitation expired by time.

Expected invitation count: `4`.

## Approval Scenarios

- Pending platform super-admin elevation.
- Pending payment configuration request.
- Pending high-value refund approval request.
- Pending self-approval-prohibited request.
- Rejected role-definition change.
- Approved enterprise-feature request with execution blocked.

Expected approval count: `6`.

The current backend queue contract does not truthfully represent executed or
failed operation completion. Those states are intentionally not seeded.

## Expected Visibility

- Platform Super Admin sees all fixture invitation and approval records.
- Internal reader sees platform invitations according to backend authorization.
- Organization-scoped internal administrator sees only matching organization
  invitation/approval records returned by the backend.
- Finance Billing Admin sees only payment/refund approval records allowed by
  backend permissions.
- Ordinary organization administrator is denied the internal platform queues.
- Suspended and expired-assignment fixtures are denial checks where the backend
  rejects effective access.

## Cleanup Safeguards

Cleanup resolves explicit fixture IDs from the batch and namespace. It refuses
to proceed if fixture users or organizations have reports, evidence records,
disputes, payment transactions or provider-organization links.

Cleanup deletes only fixture-owned approvals, invitations, role assignments,
local login/audit residue, users and the fixture organization. It does not
truncate tables, reset sequences, or delete unrelated records.

## Incident Procedure

If a guard refuses the command:

1. Stop immediately.
2. Do not override the guard.
3. Verify that `DATABASE_URL` targets local `fixzone_enterprise`.
4. Remove production-like public/callback/CORS host variables from the local
   fixture shell.
5. Re-run verification before any seed or cleanup attempt.

## Browser UAT Preparation

After seeding, keep fixtures in place. Use the account labels above and the
operator-supplied local password to perform guided browser/API UAT. Evidence
must remain sanitized and must not include credentials, tokens, invite codes,
hashes, payment secrets or personal data beyond local fixture labels.
