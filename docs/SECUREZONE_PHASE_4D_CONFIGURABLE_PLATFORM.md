# SecureZone Platform Phase 4D — Configurable Enterprise Platform

Phase 4D turns the Enterprise Service Framework into a configurable platform foundation. It does not add new business workflows.

## Tenant Service Configuration

Organizations can now hold service configuration metadata in existing `Organization.profileData`.

Supported configuration fields:

- enabled services
- default service
- service ordering
- service visibility
- branding overrides
- future SLA configuration
- future escalation configuration
- future AI preferences
- future document retention
- future regional settings

Maintenance remains enabled by default as `maintenance_report`.

## Provider Capability Framework

Provider capability metadata now supports:

- id
- name
- description
- category
- status
- verification requirement
- future certification
- future licensing
- future expiry
- future approval workflow placeholder

Active Maintenance capabilities:

- Electrical
- Plumbing
- Mechanical
- Civil Works

Future metadata-only capabilities:

- Architecture
- Medical
- Legal
- ICT
- Agriculture
- Surveying
- Security
- Property
- Education

Provider assignments continue using existing FixZone logic. Capability assignments are metadata only.

## Platform Configuration APIs

New authenticated metadata endpoints:

- `GET /api/platform/config`
- `GET /api/platform/provider-capabilities`
- `GET /api/platform/analytics-contracts`
- `GET /api/platform/service-configuration`
- `GET /api/platform/service-configuration/:organizationId`
- `PATCH /api/platform/service-configuration/:organizationId`
- `GET /api/platform/providers/:providerId/capabilities`
- `POST /api/platform/providers/:providerId/capabilities`
- `PATCH /api/platform/providers/:providerId/capabilities/:capabilityId/inactive`
- `DELETE /api/platform/providers/:providerId/capabilities/:capabilityId`

## Analytics Contracts

Maintenance registers analytics metadata for:

- dashboard widgets
- KPIs
- charts
- reports
- notifications

No analytics workflow was changed.

## Framework Guards

Non-blocking decorators were added:

- `@RequiresService()`
- `@RequiresCapability()`
- `@RequiresVerification()`

They store metadata for future enforcement but do not block existing Maintenance behavior.

## Architecture Decision

No schema migration was added. Tenant service configuration is stored in `Organization.profileData.secureZoneServiceConfiguration`. Provider capability assignments are stored in `User.profileData.secureZoneProviderCapabilities`.

This keeps Phase 4D reversible and non-breaking while providing extension points for future modules.
