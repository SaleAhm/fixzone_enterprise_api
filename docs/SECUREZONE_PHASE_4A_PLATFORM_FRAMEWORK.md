# SecureZone Platform Phase 4A — Reusable Service Module Framework

Phase 4A prepares SecureZone Platform for future service modules without changing the existing FixZone maintenance workflows.

## Current production module

- Platform: SecureZone Platform
- Active production module: FixZone / Maintenance Services
- Existing report, dispatch, provider, citizen, trust, subscription and admin workflows remain unchanged.

No backend model, route, DTO or workflow has been renamed from `Report` in this phase.

## Module registry

The platform module registry is a read-only catalog of service-module metadata. Each module definition can describe:

- module key
- display name
- module name
- description
- service categories
- client roles
- professional roles
- workflow stages
- assignment rules
- SLA rules
- analytics visibility
- billing feature flags
- production activation status
- metadata-only status

Only `maintenance` is marked as `activeProduction: true`.

Future modules such as Healthcare, Legal Services, ICT Services, Agriculture, Education, Security Services, Property / Facilities, Cleaning / Home Services, Government Services and Multi-Service Organization are metadata-only. They do not add workflows, routes, dashboards or permissions in Phase 4A.

## Organization module enablement

Organizations use the existing `Organization.enabledModules` JSON field.

Rules:

- Missing or legacy `enabledModules` values normalize to `["maintenance"]`.
- Unknown module keys are ignored.
- `maintenance` is always included.
- Future module keys can be stored as metadata-only readiness flags.
- Future metadata flags do not enable non-maintenance workflows.
- Organization Admins cannot update module enablement; this remains a Super Admin tenant-control action.

Every organization response now includes a `moduleSummary` object:

```json
{
  "enabledModuleKeys": ["maintenance"],
  "activeProductionModuleKeys": ["maintenance"],
  "metadataOnlyModuleKeys": [],
  "activeModules": [],
  "metadataOnlyModules": [],
  "maintenanceActive": true
}
```

## API

`GET /api/platform-modules`

Returns the SecureZone Platform registry and active production module metadata. The endpoint is authenticated and available to active platform roles.

Organization create/update accepts:

```json
{
  "enabledModules": ["maintenance", "healthcare"]
}
```

The response will keep Maintenance active and mark Healthcare as metadata-only.

## Compatibility contract

FixZone report workflows must continue using existing report routes and data. Phase 4A does not migrate report data, rename report models, or introduce module-specific report tables.

Existing organizations with `enabledModules: null` continue to behave as Maintenance-enabled organizations.

## Phase 4B candidates

- Add organization module-entitlement policy objects.
- Add module-scoped navigation configuration.
- Add module-aware analytics filters while keeping Report stable.
- Add module-scoped onboarding preferences.
- Add module-specific feature flag enforcement points, defaulting to non-blocking.
- Add admin audit events for module enablement changes if stricter governance is required.
