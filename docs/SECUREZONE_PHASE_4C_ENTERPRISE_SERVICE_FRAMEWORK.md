# SecureZone Platform Phase 4C — Enterprise Service Framework

Phase 4C introduces the reusable Enterprise Service Framework that future SecureZone modules can plug into without rewriting authentication, tenants, reports, dispatch, trust, billing, navigation, notifications or analytics.

## What changed

The platform now has read-only framework metadata for:

- service definitions;
- service lifecycle stages;
- assignment strategy;
- priority rules;
- SLA metadata;
- escalation rules;
- verification requirements;
- subscription requirements;
- provider capability requirements;
- region rules;
- extension-provider slots.

Maintenance Services / FixZone is the only active service implementation.

## What did not change

Phase 4C does not:

- rename `Report`;
- migrate report data;
- change report APIs;
- introduce healthcare, legal, ICT, agriculture, education, property, security or other workflows;
- enforce new access checks against existing FixZone workflows.

## Report compatibility layer

The `MaintenanceServiceAdapter` describes how existing `Report` data maps into the generic `GenericServiceRequest` contract:

| Report field | Generic field |
| --- | --- |
| `id` | `sourceId` |
| `title` | `title` |
| `description` | `description` |
| `category` | `category` |
| `location` | `location` |
| `status` | `lifecycleStage` |
| `citizenId` | `requesterId` |
| `organizationId` | `organizationId` |
| `assignedProviderId` | `assignedProfessionalId` |

This is an adapter, not a migration. Existing FixZone reports remain the source of truth.

## Provider capability framework

Provider capabilities are now represented as framework metadata.

Active Maintenance capability examples:

- Electrical
- Civil Works
- Plumbing / Water

Future metadata-only capabilities include:

- Architecture
- Medical
- Legal
- ICT
- Agriculture
- Security
- Property / Facilities
- Education

These future capabilities do not enable future workflows yet.

## Service registration framework

Each service implementation can eventually register:

- supported service types;
- supported provider capabilities;
- assignment strategy;
- dashboard widget provider;
- analytics provider;
- notification provider;
- AI provider placeholder;
- document provider.

Maintenance currently registers existing providers:

- `maintenance.dashboard.existing`
- `maintenance.analytics.existing`
- `maintenance.notifications.existing`
- `maintenance.dispatch-ai.existing`
- `maintenance.evidence.existing`

## Backend endpoints

- `GET /api/enterprise-services`
- `GET /api/enterprise-services/definitions`
- `GET /api/enterprise-services/provider-capabilities`
- `GET /api/enterprise-services/maintenance/registration`

All endpoints are authenticated and read-only.

## Frontend foundation

Flutter now has reusable framework models in `EnterpriseServiceFramework`.

The Admin Organizations workspace displays the active registered implementation and provider capability metadata without exposing unfinished modules.

## Future module development guide

To add a future module safely:

1. Add metadata to the module registry.
2. Add a service definition.
3. Add provider capability metadata.
4. Add an adapter if existing data maps to the generic request contract.
5. Add extension providers for dashboard, analytics, notifications, AI and documents.
6. Keep access enforcement non-blocking until the module has real workflows and tests.

## Phase 4D candidates

- Add a backend service-definition registry that can merge static and tenant-level config.
- Add module-aware provider capability assignment UI.
- Add module-aware analytics contracts.
- Add optional framework decorators/guards, defaulting non-blocking.
- Add dynamic frontend navigation fed from service definitions.
