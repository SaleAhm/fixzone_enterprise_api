# Phase 2 Data Model Governance

Date: 2026-07-09

## Purpose

This document defines data model governance for Phase 2 planning. It is documentation-only and does not authorize schema changes, migrations, code changes, package installation, pushes, merges, deployments, service restarts, or production database activity.

## Current Production Data Baseline References

Current production foundation:

- Maintenance/FixZone remains the only active production workflow.
- `Report` remains the source-of-truth entity for Maintenance/FixZone service requests.
- Existing report evidence fields and `/uploads/...` references remain valid.
- Existing organization, user, provider, notification, trust, KYC, evidence, dispute, audit, demo, platform setting, and backup records remain in their current models.
- Future enterprise modules remain metadata-only or locked until separately approved.

Primary current models:

- `Organization`
- `User`
- `Report`
- `ReportActivity`
- `Notification`
- `ProviderOrganization`
- `Invitation`
- `EvidenceRecord`
- `KycSubmission`
- `LoginHistory`
- `DisputeCase`
- `DisputeMessage`
- `UserEntitlement`
- `ComplianceAuditLog`
- `DemoAuditLog`
- `PlatformSetting`
- `PlatformBackup`

## Entity Ownership Model

- `Organization` owns tenant-level users, reports, provider links, invitations, evidence records, disputes, and compliance audit logs.
- `User` owns identity, role, account status, authentication linkage, profile data, trust state, reports, notifications, KYC submissions, evidence uploads, disputes, and entitlement.
- `Report` owns Maintenance/FixZone work lifecycle data, evidence image references, assignment state, completion state, citizen feedback, notifications, and activity history.
- `EvidenceRecord` belongs to an uploader, optionally an owner user, optionally an organization, and a related entity reference.
- `DisputeCase` belongs to an opener, optional target user, optional organization, related entity, messages, and resolution metadata.
- `ProviderOrganization` is the joining entity between provider users and organizations.
- `ComplianceAuditLog`, `ReportActivity`, `LoginHistory`, and `DemoAuditLog` are traceability records and should remain append-oriented.

Ownership rule: every Phase 2 data addition must clearly identify the owning tenant, owning user, related entity, and actor where applicable.

## Tenant Boundary Requirements

- Tenant-scoped data must include or derive an `organizationId`.
- Cross-tenant reads must be denied unless performed by an explicitly authorized super-admin path.
- Provider access must remain limited to assigned reports or approved provider-organization relationships.
- Citizen access must remain limited to owned reports, notifications, evidence, KYC, disputes, and permitted platform data.
- Organization admins must remain limited to their organization unless a super-admin path is used.
- Future module metadata must not grant access to another tenant's records.
- Demo data must remain identifiable through `isDemo`, `demoBatchId`, or related demo metadata where applicable.

## Multi-Tenant Isolation Rules

- Do not create global data queries without a tenant filter unless the route is explicitly super-admin-only.
- Any new entity that can contain tenant data should include `organizationId` or a documented tenant derivation path.
- Any new evidence, entitlement, capability, or service-request metadata must preserve tenant isolation.
- Index tenant-scoped records by `organizationId` where read patterns require it.
- Preserve existing `Organization` hierarchy semantics; do not treat parent-child relationships as permission inheritance unless explicitly designed.
- Avoid storing tenant-sensitive details in generic JSON fields without validation and access rules.

## Entity Naming Conventions

- Preserve existing model names for current production concepts.
- Do not rename `Report` in Phase 2.
- New generic enterprise concepts should use explicit names, for example `ServiceDefinition`, `ModuleEntitlement`, or `ProviderCapabilityAssignment`, only after approval.
- Avoid overloaded names such as `Request` where existing `Report` semantics are still active.
- Future module entities should include module context in the name or data model where ambiguity is possible.
- Audit and event models should include the domain and purpose in the name.
- Field names should follow existing camelCase Prisma conventions.

## Migration Governance Rules

- Default Phase 2 position: no migrations.
- Any migration requires separate approval before implementation.
- Migrations must be additive by default.
- Prefer nullable fields, new tables, or metadata tables over destructive changes.
- Do not drop columns, rename columns, rename tables, or change enum values without a dedicated migration and rollback plan.
- Do not move existing report evidence data without an approved evidence migration plan.
- Do not split `Report` into module-specific tables during Phase 2.
- Every approved migration must include:
  - purpose;
  - affected models;
  - data impact;
  - tenant impact;
  - rollback strategy;
  - staging validation;
  - production data-safety checklist.

## Soft-Delete and Archival Guidance

- Prefer status-based deactivation for business entities that may need audit history.
- Existing archival patterns include `OrganizationStatus.ARCHIVED`, `AccountStatus.DEACTIVATED`, suspension statuses, and timestamped lifecycle fields.
- Avoid hard-deleting tenant, user, report, evidence, dispute, or audit records unless the domain already supports deletion safely.
- Keep audit, login history, report activity, compliance, and dispute message records append-oriented.
- If archival is introduced for a new entity, include:
  - archived status or archived timestamp;
  - actor responsible for archival where needed;
  - tenant filter preservation;
  - restoration or non-restoration policy.

## Audit and Traceability Requirements

- Mutations to organization configuration, module entitlements, provider capabilities, evidence access, trust enforcement, and administrative actions should create traceability records.
- New high-risk Phase 2 entities should record `createdAt` and, where mutable, `updatedAt`.
- Actor identifiers should be recorded for administrative or security-sensitive changes.
- Evidence access changes should record safe metadata without logging raw file content or secrets.
- Rate-limit and access-denial observability should avoid storing sensitive payloads.
- Audit records must remain tenant-filterable where tenant context exists.

## Extensibility Requirements for Future Enterprise Modules

- Maintenance/FixZone remains active while future modules remain metadata-only until separately approved.
- New module data structures should be additive and should not require changing existing `Report` records.
- Generic enterprise service metadata must remain compatible with the Maintenance adapter.
- Future module enablement should be represented as metadata or entitlement policy before workflow activation.
- Provider capability extensions should preserve existing provider category and organization-link behavior.
- Analytics extensions should read through compatibility adapters before introducing module-specific data stores.
- Any future active module must receive its own workflow, DTO, API, tenant isolation, and rollback review before production activation.

## Relationship Management Rules

- Preserve existing required relationships for `Report.organization`, `Report.citizen`, and provider assignment semantics.
- Preserve cascade behavior only where already intentional, such as dependent messages or report activities.
- Use `onDelete: SetNull` for historical references where audit continuity matters and ownership can safely become nullable.
- Use join tables for many-to-many tenant or capability relationships.
- Avoid storing relationship-critical data only in JSON.
- If JSON metadata is used, document expected shape and validation rules.
- Every new relationship must document owner, lifecycle, deletion behavior, and tenant scope.

## Backward Compatibility Requirements

- Existing `Report` records must remain readable and writable through current Maintenance/FixZone APIs.
- Existing evidence image fields and evidence records must remain usable.
- Existing enum values must remain valid.
- Existing demo data identification must remain intact.
- Existing organization, user, provider, notification, trust, KYC, dispute, and platform tool behavior must remain compatible.
- New fields should not be required for old records unless a backfill and validation plan is approved.
- Existing mobile and admin clients must not require a data model migration to continue using Maintenance workflows.

## Data Validation Requirements

- Validate tenant ownership before reads and writes.
- Validate actor role and organization scope before mutations.
- Validate IDs belong to the expected entity type and tenant.
- Validate enum values through DTOs and service-layer checks.
- Validate JSON metadata shapes where they influence access, billing, evidence, module activation, or provider capabilities.
- Validate evidence file references against approved path or delivery policies.
- Validate future module keys against the platform module registry.
- Reject unknown module keys for enforcement paths while preserving metadata-only readiness behavior where approved.

## Rollback Considerations

- Documentation-only changes are low rollback complexity.
- Additive nullable fields are usually low to medium rollback complexity if old code can ignore them.
- New tables are medium rollback complexity if they store live workflow data.
- New entitlement or evidence access tables are medium to high rollback complexity because policy evaluation may depend on them.
- Any change to `Report`, report evidence fields, or tenant identifiers is high rollback complexity.
- Enum changes are high rollback complexity and should be avoided unless separately approved.
- Rollback plans must include validation commands and data handling instructions before implementation begins.

## Recommended Governance Principles for Phase 2

- Protect Maintenance/FixZone first.
- Keep `Report` stable.
- Keep tenant ownership explicit.
- Prefer additive schema design.
- Make future modules metadata-first and workflow-later.
- Keep audit and traceability append-oriented.
- Treat evidence, identity, trust, and entitlements as high-sensitivity data.
- Avoid destructive migrations.
- Keep JSON metadata governed and validated.
- Require rollback planning before any migration.
- Require full regression validation after any approved data model change.

## Implementation Hold

This governance document does not start Phase 2 implementation. Any data model change must wait for explicit tranche approval, migration governance approval, validation planning, and rollback planning.
