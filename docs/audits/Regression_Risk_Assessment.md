# Regression Risk Assessment

Date: 2026-07-09  
Scope: Baseline A production deployment vs Baseline B post-production milestone branches.  
Mode: Documentation-only assessment. No implementation, refactor, merge or source-code modification performed.

## Executive Summary

The milestone work is valuable and should be preserved, but it is not a low-risk direct production merge. The backend milestone branch introduces large platform foundations across module registry, platform configuration, enterprise service metadata and workflow orchestration. The Flutter milestone branch introduces broad UI/navigation/platform changes across admin, citizen, provider, onboarding, module access and responsive layout areas.

Overall regression risk: High until staged integration, validation and staging smoke tests are completed.

Primary risk drivers:

- Authentication/provider login has had repeated regressions and was recently stabilized.
- Admin mobile navigation and Platform Tools have had visible runtime/layout regressions.
- Organization/module/platform configuration touches multi-tenant and admin surfaces.
- Business logic orchestration touches report completion, notifications, audit and analytics pipelines.
- Backend and frontend milestone branches are ahead of their remotes and must be preserved before merge activity.
- Documentation repository contains uncommitted Phase 5E work that must not be overwritten.

## Baseline Comparison

### Baseline A: Current Production Deployment

Protected production behavior includes:

- Citizen report submission and tracking.
- Provider login, job view, acceptance/completion and evidence upload.
- Admin/super admin login, dispatch, reports, providers, organizations and platform tools.
- Existing report lifecycle and API contracts.
- Organization scoping and RBAC.
- Current database schema/migrations in production.

Exact deployed commit hashes still need production confirmation.

### Baseline B: Post-Production Milestone Branches

Backend branch delta from `main` to `phase-4-platform-expansion`:

- 47 changed files.
- Approximately 5,541 insertions and 24 deletions.
- Adds platform module registry, platform configuration, enterprise service framework, business logic orchestration and tests.
- Modifies auth, report, organization and users services.

Frontend branch delta from `master` to `phase-4-platform-expansion`:

- 53 changed files.
- Approximately 3,482 insertions and 765 deletions.
- Adds module access helper and enterprise service framework client-side support.
- Modifies admin navigation, admin organizations, Platform Tools, providers, onboarding, citizen home, provider login and shared responsive layout.

Documentation baseline:

- Docs repo has uncommitted Phase 5E documentation and ADR updates.

Website baseline:

- Website repo appears clean and aligned with production branding.

## Regression Risk Matrix

| Area | Current Status | Risk | Integration Complexity | Production Impact | Testing Priority | Rollback Complexity | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Authentication | Stable but historically sensitive | Critical | High | Critical | P0 | Medium | Medium |
| Provider login | Recently stabilized in milestone | Critical | High | Critical | P0 | Medium | Medium |
| RBAC/authorization | Mature but cross-cutting | High | High | Critical | P0 | High | Medium |
| Organizations | Mature plus new module fields | High | High | High | P0 | Medium | Medium |
| Multi-tenancy | Core invariant | Critical | High | Critical | P0 | High | Medium |
| Citizen portal | Broad stable functionality | Medium | Medium | High | P1 | Low-Medium | Medium-High |
| Provider portal | Recently stabilized | High | Medium | High | P0 | Medium | Medium |
| Admin portal | Broad milestone UI changes | High | High | High | P0 | Medium | Medium |
| Super Admin | Platform tools/config changes | High | High | High | P0 | Medium | Medium |
| Assignment workflow | Existing + orchestration touchpoints | High | High | Critical | P0 | Medium-High | Medium |
| Completion workflow | Orchestration touches event flow | High | High | Critical | P0 | Medium-High | Medium |
| Notifications | Pipeline changes in milestone | Medium-High | Medium | High | P1 | Medium | Medium |
| Evidence uploads | Must remain unchanged | Medium-High | Medium | High | P0 | Medium | Medium |
| Analytics | Placeholder/pipeline foundations | Medium | Medium | Medium | P2 | Low | Medium |
| Platform modules | New metadata foundation | Medium | Medium | Medium | P1 | Low-Medium | High |
| Future modules | Metadata-only | Medium | Medium | Medium | P1 | Low | High if locked |
| Database schema | No destructive migration in observed diff | Medium | Medium | High | P0 | High | Medium |
| API contracts | Existing APIs touched indirectly | High | High | Critical | P0 | Medium | Medium |
| Flutter mobile UI | Recent overflow regressions | High | Medium | High | P0 | Low | Medium |
| Flutter desktop UI | Broad but less constrained | Medium | Medium | Medium | P1 | Low | Medium-High |
| Website | Clean, mostly isolated | Low | Low | Medium | P2 | Low | High |
| Infrastructure | Deployment evidence incomplete | High | Medium | Critical | P0 | High | Medium |
| Git/release | Baseline preservation risk | Critical | High | Critical | P0 | High | Medium |

## Features That Could Break

- Provider login by email/password and provider ID/password.
- Admin role routing for super admin, organization admin and dispatch users.
- Organization data visibility and tenant scoping.
- Admin providers screen and dispatch assignment identifiers.
- Platform Tools panel rendering.
- Citizen report submission and image/evidence upload.
- Provider completion evidence flow.
- Citizen completion confirmation/review.
- Notification generation on workflow transitions.
- Audit log generation for report/workflow events.
- Admin organization module status display.
- Mobile admin bottom navigation and More menu.
- API base URL behavior for Flutter Web vs Android.

## Business Logic at Risk

- Report assignment and reassignment lifecycle.
- Provider acceptance/completion.
- Citizen validation and closure.
- Notification fanout.
- Audit trail continuity.
- Platform configuration appearing to enforce future module rules.
- Subscription/entitlement placeholders being interpreted as active enforcement.

## Authentication and Authorization Risks

Authentication and RBAC should not be modified during integration except through explicit reviewed commits. Risk factors:

- Provider account lookup now supports provider ID paths in milestone work.
- User role mapping must continue routing provider/admin/org-admin correctly.
- Organization admin and dispatch scoping must not become global.
- Password reset and seeded-user hashes must remain valid.

## Database and Migration Risks

No destructive database migration was observed in the branch-stat review, but production integration still requires:

- Prisma migration status check.
- Migration dry-run or staging deploy.
- Seed-data review.
- Rollback plan if new code assumes fields not present in production.

## API Compatibility Risks

The backend adds new endpoints and changes some service behavior. Existing production API contracts should remain unchanged:

- Auth login/session endpoints.
- Report creation/list/detail/update endpoints.
- Provider job endpoints.
- Organization endpoints.
- Notification endpoints.
- Upload/evidence endpoints.

New metadata/configuration endpoints should be additive and non-blocking.

## Flutter UI Risks

Highest risk Flutter areas:

- `admin_home_shell.dart`
- `admin_navigation.dart`
- `admin_organizations_screen.dart`
- `admin_platform_tools_screen.dart`
- `admin_providers_screen.dart`
- `provider_login_screen.dart`
- `responsive_layout.dart`
- `api_service.dart`

Required manual validation:

- Mobile widths 360, 390 and 430px.
- Android emulator Pixel.
- Desktop web.
- Tablet width.

## Website Risks

Low integration risk because the website is isolated and clean. Main release risks are content/marketing quality:

- Contact form delivery.
- SEO metadata.
- Accessibility.
- Analytics/cookie readiness.

## Deployment Risks

- Production deploy branch may lag main/milestone branches.
- Exact production live commits are not yet confirmed.
- Environment variables and CORS origins must match new frontend/backend expectations.
- Database migration state must be verified before code rollout.

## Risk Classification Summary

Critical:

- Git baseline preservation.
- Authentication/provider login.
- Multi-tenancy/organization scoping.
- Production API contract preservation.

High:

- Admin/Super Admin surfaces.
- Assignment and completion workflow.
- Mobile UI responsiveness.
- Deployment/migration readiness.

Medium:

- Notifications, analytics placeholders, platform module metadata.

Low:

- Website integration, provided it remains independent.

