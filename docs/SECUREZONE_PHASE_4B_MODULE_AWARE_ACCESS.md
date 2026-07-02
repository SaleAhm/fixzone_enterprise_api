# SecureZone Platform Phase 4B — Module-Aware Navigation & Access Foundation

Phase 4B adds shared access vocabulary and reusable navigation metadata while keeping FixZone / Maintenance Services as the only active production workflow.

## Non-breaking scope

Phase 4B does not:

- create Healthcare, Legal, ICT, Agriculture, Education, Property, Security or other workflows;
- rename `Report`;
- migrate report data;
- change existing report, dispatch, provider, citizen, trust or subscription behavior;
- enforce module access checks on existing FixZone report APIs.

## Access states

The platform now uses three access states:

- `allowed` — user can open/use the area.
- `locked` — item may remain visible, but future enforcement can block action with a clear reason.
- `hidden` — item should not be shown for the current role/context.

Maintenance defaults are intentionally permissive so existing FixZone workflows keep working.

## Frontend navigation metadata

Admin navigation items can now declare:

- `moduleId`
- `requiredRoles`
- `requiredVerificationLevel`
- `requiredSubscriptionPlans`
- `requiresOrganization`
- `enabled`
- `hiddenWhenDenied`
- locked/denied message

The current admin shell evaluates this metadata for visibility. Existing routes are preserved and no route names were removed.

## Shared frontend access helper

`ModuleAccessEvaluator` evaluates a `ModuleAccessPolicy` against a `ModuleAccessContext` and returns an access result:

```dart
ModuleAccessResult(
  state: ModuleAccessState.allowed,
  allowed: true,
  visible: true,
  message: 'Access allowed.',
)
```

Future modules can plug into navigation by adding metadata first, then later adding real screens/workflows in a separate phase.

## Backend access foundation

`PlatformModulesService.evaluateAccess()` checks:

- module existence;
- metadata-only vs active production status;
- role requirements;
- organization requirement;
- organization enabled modules;
- verification-level placeholder;
- subscription-plan placeholder.

`GET /api/platform-modules/access/:moduleKey` exposes a lightweight access evaluation endpoint for authenticated roles.

## Current production behavior

- `maintenance` evaluates as allowed for current platform roles.
- future modules evaluate as locked because they are metadata-only.
- unknown modules evaluate as hidden.

## Phase 4C candidates

- Add module-aware route groups for client/provider portals.
- Add server-side decorators/guards that can be enabled per endpoint, still default non-blocking.
- Add audit logs for module-access denials once enforcement begins.
- Add organization-level module entitlement objects and plan mapping.
- Add dynamic navigation retrieval from backend configuration.
