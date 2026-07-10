# Phase 2 Runtime Impact Assessment

Date: 2026-07-09

## Purpose

This assessment identifies the likely runtime impact of Phase 2 before implementation begins. It is documentation-only and does not authorize code, migration, dependency, deployment, or production activity.

## Current Production Baseline References

- Active production workflow: Maintenance/FixZone.
- Active backend source of truth: existing `Report` workflows, report evidence paths, dispatch flows, provider assignments, citizen review, trust records, notifications, and admin dashboards.
- Active frontend foundation: existing Flutter Maintenance/FixZone role experiences for citizen, provider, org admin, and super admin.
- Active website foundation: current SecureZone digital experience website stabilization branch.
- Phase 1 runtime baseline:
  - Enterprise rate limiting is implemented locally.
  - Evidence upload validation is hardened locally.
  - Full backend, frontend, and website validation passed during Phase 1 closure.
- Platform expansion baseline:
  - Future modules remain metadata-only or locked.
  - Maintenance remains the only active production module.
  - Existing `Report` APIs and data model are not renamed or replaced.

## Components Potentially Affected During Phase 2

- Backend API routing, guards, throttling, and evidence delivery.
- Upload validation, storage, static serving, and future protected delivery.
- Report evidence references and compatibility with existing `/uploads/...` URLs.
- Organization module enablement and future entitlement policy evaluation.
- Provider capability metadata and module-aware provider assignment readiness.
- Trust, evidence, and dispute records where evidence access may be linked.
- Notification flows that reference report or evidence state.
- Flutter role-based navigation, admin shells, provider workflows, and citizen evidence views.
- Website only if Phase 2 includes public messaging or dependency maintenance.
- Database schema only if an approved additive migration is introduced.

## Backend Impact Matrix

| Area | Potential Change | Runtime Risk | Rollback Complexity | Mitigation |
| --- | --- | --- | --- | --- |
| Evidence delivery | Protected or signed access for uploaded evidence | High | High | Preserve legacy compatibility path, add access-matrix tests, stage before release |
| Upload lifecycle | Malware scanning, image dimensions, additional rejection rules | Medium | Medium | Feature flag enforcement, log rejection reasons, keep Phase 1 validation tests |
| Rate limiting | Observability and threshold tuning | Medium | Low | Use config gates, monitor `429` rates, document emergency overrides |
| Module entitlements | Organization-level module policy objects | Medium | Medium | Keep Maintenance permissive, future modules locked, add entitlement audit tests |
| Access enforcement | Optional guards/decorators for future modules | Medium | Medium | Default non-blocking for existing Maintenance routes |
| Enterprise services | Expanded service definitions and adapters | Low | Low | Keep read-only metadata unless separately approved |
| Notifications | Evidence or entitlement state messaging | Low | Low | Avoid changing existing notification contracts without tests |
| Trust records | Evidence links or access policy references | Medium | Medium | Preserve existing record visibility and ownership rules |

## Frontend Impact Matrix

| Area | Potential Change | Runtime Risk | Rollback Complexity | Mitigation |
| --- | --- | --- | --- | --- |
| Evidence viewing | Protected evidence URL handling | High | Medium | Maintain old URL fallback, test role-specific views |
| Upload flows | Scanner/dimension validation feedback | Medium | Medium | Add clear client-side error states and preserve retry behavior |
| Admin navigation | Module entitlement visibility states | Medium | Low | Keep Maintenance visible, future modules locked or hidden by policy |
| Provider workflows | Capability metadata and assignment readiness | Medium | Medium | Do not block current Maintenance providers without explicit policy |
| Citizen workflows | Report evidence and review flow compatibility | Medium | Medium | Regression-test create report, upload evidence, review completion |
| Platform tools | Rate-limit and evidence operational surfaces | Low | Low | Keep tools additive and role-gated |
| Website | Public copy or dependency maintenance | Low | Low | Separate website changes from runtime platform tranches |

## Database Impact Matrix

| Area | Potential Change | Data Risk | Rollback Complexity | Mitigation |
| --- | --- | --- | --- | --- |
| Evidence access | New evidence metadata or access table | High | High | Additive-only schema, no moving existing files, migration approval required |
| Upload scanning | Scan status, scanner metadata, rejection metadata | Medium | Medium | Nullable additive fields, no blocking reads if missing |
| Module entitlements | Organization entitlement records | Medium | Medium | Additive tables, default Maintenance enabled |
| Provider capabilities | Capability mappings by module | Medium | Medium | Preserve existing provider fields and maintenance capability behavior |
| Audit/observability | Rate-limit and access-denial audit records | Low | Low | Additive event logging only |
| Existing reports | Any change to `Report` model or evidence fields | High | High | Out of scope unless separately approved |

## API Compatibility Considerations

- Existing Maintenance/FixZone API routes must remain stable.
- Existing report creation, assignment, status transition, evidence upload, completion evidence, citizen review, and notification APIs must retain current contracts unless a versioned change is approved.
- Existing `/uploads/...` references must remain readable during any evidence delivery transition.
- Future module APIs should be additive and authenticated.
- Metadata endpoints for future modules should not imply production workflow activation.
- Rate-limit responses should remain predictable and documented for clients.
- Upload rejection responses should avoid exposing sensitive file internals while remaining actionable.

## Multi-Tenant Isolation Considerations

- Evidence access must enforce organization and ownership boundaries.
- Provider access must remain limited to assigned or authorized reports.
- Organization module entitlements must not leak future module capability into unrelated tenants.
- Super admin visibility should remain explicit and audited.
- Future module metadata can be visible only where role and tenant policy allow.
- Cross-tenant report, evidence, trust, notification, and provider capability queries need regression coverage.

## Authentication and RBAC Impact Considerations

- Current JWT authentication behavior must remain compatible.
- Existing role gates for citizen, provider, org admin, and super admin must remain intact.
- New evidence delivery endpoints must require authentication unless explicitly designed for signed public access.
- Module entitlement checks must not override existing Maintenance RBAC accidentally.
- Future module locked/hidden states should map cleanly to user-facing frontend behavior.
- Any new guard must default to non-breaking behavior for existing Maintenance endpoints unless explicitly approved.

## Rollback Complexity Classification

| Change Class | Complexity | Reason |
| --- | --- | --- |
| Documentation-only governance | Low | Revert documentation commit if needed |
| Rate-limit threshold tuning | Low | Config or small code revert, no data migration expected |
| Read-only metadata expansion | Low | Additive and non-blocking if future modules remain inactive |
| Frontend navigation metadata | Low to Medium | UI behavior rollback may require coordinated frontend release |
| Upload validation changes | Medium | Client compatibility can be affected |
| Upload scanning | Medium | Depends on scanner availability and fail-open/fail-closed policy |
| Module entitlement persistence | Medium | May add database records and policy behavior |
| Protected evidence delivery | High | Affects file access, compatibility, RBAC, and user workflows |
| Existing report data migration | High | Explicitly out of Phase 2 default scope |

## Risk Levels

| Risk | Level | Notes |
| --- | --- | --- |
| Breaking Maintenance/FixZone workflows | High | Must be the primary blocking gate |
| Evidence confidentiality exposure | High | Public upload links remain a known risk until protected delivery |
| Upload false rejections | Medium | Strict validation and scanning may reject client files |
| Rate-limit false positives | Medium | Legitimate retries may trigger `429` responses |
| Tenant boundary regression | High | Evidence and entitlement work can cross tenant boundaries if not tested |
| RBAC regression | High | New guards or policies can block valid users or allow invalid access |
| Database rollback difficulty | Medium to High | Depends on whether migrations are introduced |
| Future module accidental activation | High | Must remain locked/metadata-only until separately approved |
| Dependency freshness issues | Low to Medium | Known website Browserslist warning and backend `pg` warning |

## Recommended Mitigation Strategies

- Keep Maintenance/FixZone compatibility as a hard acceptance gate.
- Use additive, reversible changes.
- Put enforcement behavior behind feature flags or config gates where practical.
- Preserve legacy evidence path compatibility during protected delivery rollout.
- Add role and tenant access matrix tests before evidence endpoint implementation.
- Keep future modules locked or metadata-only unless separately authorized.
- Avoid combining dependency updates with runtime behavior changes.
- Require migration approval before any schema change.
- Record rollback steps before implementation starts for each tranche.
- Validate every tranche with backend, frontend, and website command sets where impacted.

## Required Validation Activities Before Implementation

Before starting any runtime tranche:

- Confirm branch owners approved the Phase 2 baseline.
- Confirm current branches are non-production branches.
- Confirm working trees have no unrelated source changes.
- Confirm remaining untracked Phase 1 docs have an owner decision.
- Confirm the selected tranche has a design note, test plan, rollback note, and migration assessment.

Backend validation baseline:

- `npx prisma validate`
- `npx prisma generate`
- `npm run build`
- `npm test -- --runInBand`
- `npm run test:e2e -- --runInBand`

Frontend validation baseline:

- `flutter analyze`
- `flutter test`
- `flutter build web --release`

Website validation baseline:

- `npm run build`
- `npm run typecheck`
- `npm run lint`

Tranche-specific validation:

- Evidence delivery: tenant and role matrix tests.
- Upload lifecycle: scanner behavior, dimension limits, old evidence references, and rejection handling.
- Rate limiting: legitimate flow checks and expected throttling checks.
- Module entitlements: `allowed`, `locked`, and `hidden` state tests.
- Enterprise framework: compatibility tests proving existing `Report` workflows remain unchanged.

## Implementation Hold

This assessment does not start or authorize implementation. Phase 2 runtime work should begin only after the required prerequisites, owner approvals, rollback notes, and validation plans are complete.
