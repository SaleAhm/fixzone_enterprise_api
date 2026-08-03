# Server-Authoritative Responsibility Workflow

## Confirmed Domain Model

FixZone already separates several responsibility concepts:

- `Report.organizationId` is the authoritative responsible organization for accepted or overridden ownership.
- `Report.assignedOrganizationId` is the responsibility-review candidate marker.
- `Report.status = TRIAGE` means platform custody/resolution.
- `Report.status = ORG_REVIEW` means an organization is being asked to accept or reject responsibility.
- `Report.status = PENDING` means responsibility is accepted and provider dispatch is available.
- Provider assignment remains separate through `assignedProviderId` and provider organization membership.

Governance and enterprise provisions already exist and are reused rather than duplicated:

- `ComplianceAuditLog`, `ReportActivity`, `Notification`
- `DelegatedAuthority`, `AdminScope`, `RolePermission`
- `RegulatoryCase`, `RegulatoryExport`, `EvidencePackage`
- `JurisdictionZone`
- `PotentialAsset`, `AssetCandidateOwner`, `AssetClaim`, `OwnershipRecommendation`, `AssetOwnershipHistory`

## Routing Semantics

Citizen report creation is server authoritative. The backend evaluates responsibility and returns one of:

- `HIGH_CONFIDENCE`: one deterministic eligible organization. The report enters `ORG_REVIEW`, `assignedOrganizationId` is set, and `organizationId` remains the current authoritative owner until acceptance.
- `AMBIGUOUS`: multiple credible organizations. The report remains `TRIAGE` and platform resolvers are notified.
- `UNMATCHED`: no eligible organization. The report remains `TRIAGE`.
- `RESTRICTED_OR_CONFLICTED`: explicit exclusion or governance-style conflict. The report remains `TRIAGE`.

Routing precedence is extensible and currently evaluates available data in this order:

1. Existing asset ownership/candidate ownership/approved asset claims.
2. Organization mandate and supported categories from profile metadata.
3. Provider category capability and coverage inherited from active organization/provider membership.
4. Organization active status, billing/operational readiness, maintenance module readiness.
5. Jurisdiction text and coverage areas.
6. Explicit responsibility exclusions.

## Acceptance And Rejection

Organization acceptance requires active organization membership through `ORG_ADMIN` or `DISPATCH_OFFICER`, verifies `assignedOrganizationId`, sets `organizationId` to the accepting organization, moves the report to `PENDING`, records activity/audit, notifies the citizen and organization, and makes provider dispatch available.

Organization rejection requires a reason, optionally validates a suggested organization, clears `assignedOrganizationId`, returns the report to `TRIAGE`, records audit/activity metadata, notifies platform resolvers, and sends the citizen only safe wording.

## Super Admin Override

Manual routing is an exception path. Super Admin routing requires a reason. By default it places the target organization into review using `assignedOrganizationId`. If `establishAuthoritativeOwnership` is explicitly true, the route is treated as a platform override, immediately sets `organizationId`, moves the report to `PENDING`, and records override metadata.

## Audit And Notifications

Significant transitions write `ReportActivity` records and `ComplianceAuditLog` records where supported. Legacy `DemoAuditLog` compatibility is preserved.

Persistent in-app notifications are created for organization review, organization acceptance, organization rejection returned to platform, manual override, platform ambiguity/unmatched handling, and citizen-safe status updates. No external email/SMS/push delivery is claimed by this implementation.

## Analytics Readiness

The persisted activity timeline supports future real analytics for responsibility-resolution time, organization acceptance/rejection rate, unresolved cases, dispatch delay, provider response time, completion time, and citizen-confirmed satisfaction. Metrics must be derived from persisted events and timestamps; fabricated analytics are out of scope.

## Extension Points

The resolver is intentionally deterministic and explainable. Future production expansion can add GIS polygon containment, delegated maintenance contracts, regulator approval gates, effective-dated asset responsibility, multi-agency/shared jurisdiction cases, SLA escalation, and smart provider discovery without changing client-side authority.

Roadmap items not implemented in this tranche: transactional email, SMS, push, production geocoding/GIS, payment gateway, real operational analytics, advanced search, bulk dispatch, SLA dashboard, escalation engine, offline sync, predictive maintenance, digital twins, IoT, satellite/drone imagery, national asset registry, budget planning, and AI-assisted dispatch.
