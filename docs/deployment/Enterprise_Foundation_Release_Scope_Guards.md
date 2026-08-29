# Enterprise Foundation Release-Scope Guards

FixZone Maintenance Services remain the only active commercial module in this
release line. Completion Governance belongs to the maintenance report workflow.
Enterprise Governance, Investigation, Regulatory Governance, Asset Intelligence,
and enterprise evidence-package/export workflows remain foundation-grade until a
separate controlled integration and UAT path approves them.

Frontend hiding is not authorization. Backend foundation routes must stay guarded
by authentication, role checks, rate limits, tenant checks where applicable, and
the default-off enterprise feature guard.

## Default-Off Configuration

All enterprise foundation APIs require the master flag and the specific feature
flag to be set to the exact value `true`.

```text
SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED=false
SECUREZONE_ENTERPRISE_GOVERNANCE_ENABLED=false
SECUREZONE_INVESTIGATION_ENABLED=false
SECUREZONE_REGULATORY_GOVERNANCE_ENABLED=false
SECUREZONE_ASSET_INTELLIGENCE_ENABLED=false
SECUREZONE_EVIDENCE_EXPORT_WORKFLOWS_ENABLED=false
```

When an authenticated user belongs to an organization, the guard also requires
that organization's enabled module list to include the matching foundation module
key. `SUPER_ADMIN` by itself is not sufficient to activate an unfinished
foundation API.

Enabling these variables only permits controlled technical access. It does not
declare the feature commercially ready and must not be marketed as production
functionality.

## Naming Ownership

- Completion Governance: maintenance report completion review and closure policy.
- Enterprise Governance: delegated authority, sub-admin permissions, regulatory
  cases, evidence governance, investigation coordination, and asset foundations.

The existing `/governance` backend route remains for compatibility during this
tranche, but it is owned by Enterprise Governance and must remain default-off.
A later compatibility-controlled route migration should move enterprise routes
to a clearer namespace before public exposure.

## Migration Release Procedure

Normal application startup must not silently apply migrations. Production schema
changes are an explicit release operation:

1. Create and verify a fresh backup.
2. Inspect the migration plan and classify release scope.
3. Obtain explicit approval.
4. Run `npm run migrate:release`.
5. Start or restart the application.
6. Run post-deployment smoke tests.

Rollback after migrations requires schema restoration planning and preservation
of any records written to newly activated foundation tables.
