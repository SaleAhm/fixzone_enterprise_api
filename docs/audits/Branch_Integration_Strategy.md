# Branch Integration Strategy

Date: 2026-07-09

## Objective

Integrate valuable milestone work into production without losing Baseline A production stability or Baseline B milestone progress.

## Integration Principles

- Never merge directly into production branches.
- Never force-push protected branches.
- Never delete milestone branches before tags and release acceptance.
- Prefer reviewed PRs over local merges.
- Keep Maintenance/FixZone as the only active production service.
- Keep future modules metadata-only.

## Recommended Branch Model

Backend:

- Source: `phase-4-platform-expansion`
- Target: `release/securezone-v2-stabilization`
- Production target after validation: `main` and/or deploy branch as appropriate.

Frontend:

- Source: `phase-4-platform-expansion`
- Target: `release/securezone-v2-stabilization`
- Production target after validation: `master` and/or deploy branch as appropriate.

Docs:

- First commit current Phase 5E documentation.
- Then create release documentation tag.

Website:

- Keep isolated unless website changes are explicitly included in release.

## Integration Order

1. Preserve docs Phase 5E work.
2. Push backend/frontend local milestone branches.
3. Create release branches from production baseline.
4. Merge backend platform foundation.
5. Merge backend workflow orchestration.
6. Merge backend provider auth stabilization.
7. Merge frontend module navigation/access foundation.
8. Merge frontend organization/platform/admin surfaces.
9. Merge frontend provider auth/mobile stabilization.
10. Validate full stack.
11. Deploy to staging.
12. Promote to production.

## Branches Requiring Manual Review

Backend:

- `src/auth/auth.service.ts`
- `src/report/report.service.ts`
- `src/organization/organization.service.ts`
- `src/users/users.service.ts`
- `src/business-logic/*`
- `src/platform-configuration/*`
- `src/platform-modules/*`

Frontend:

- `lib/core/services/api_service.dart`
- `lib/features/provider/presentation/screens/provider_login_screen.dart`
- `lib/features/admin/presentation/navigation/admin_navigation.dart`
- `lib/features/admin/presentation/screens/admin_home_shell.dart`
- `lib/features/admin/presentation/screens/admin_platform_tools_screen.dart`
- `lib/features/admin/presentation/screens/admin_providers_screen.dart`
- `lib/features/admin/presentation/screens/admin_organizations_screen.dart`
- `lib/shared/presentation/widgets/responsive_layout.dart`

## Isolated Until Later Phases

- Any future service workflow implementation.
- Payment gateway activation.
- Backup restore/download UI if not fully tested.
- Charts, heat maps and GPS enhancements not already production-proven.
- Destructive database migrations.
- Report model renaming.

## Merge Gates

Each merge tranche must pass:

- Build.
- Unit tests.
- E2E tests.
- Role/session smoke test.
- Organization scoping smoke test.
- Mobile layout smoke test where frontend is involved.

