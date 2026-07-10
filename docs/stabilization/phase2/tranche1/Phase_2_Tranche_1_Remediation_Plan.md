# Phase 2 Tranche 1 Remediation Plan

Date: 2026-07-10

## Purpose

This plan divides Tranche 1 remediation into small, independently reviewable batches. It is planning-only and does not implement runtime code, test, schema, dependency, lockfile, environment, migration, deployment, branch, service, production data, or tag changes.

## Current Remediation Baseline

Current validation state:

- `npx prisma validate`: passed.
- `npx eslint "{src,apps,libs,test}/**/*.ts"`: failed with 662 findings.
- `npm run build`: passed.
- `npm test -- --runInBand`: passed with `pg` deprecation warning and debug logging.
- `npm run test:e2e -- --runInBand`: passed with `pg` deprecation warning.

Final Batch 1 assessment decision:

```text
READY FOR TRANCHE 1 REMEDIATION WITH CONDITIONS
```

## Batch 1A: Formatting and Deterministic Lint Corrections

Goal: remove low-risk formatting and unused-symbol findings before deeper type-safety work.

| ID | Affected File or Module | Root Cause | Proposed Change | Runtime Behavior Impact | Tenant-Isolation Impact | RBAC/Auth Impact | Database Impact | Risk | Rollback Method | Required Tests | Acceptance Criteria | Recommended Commit Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1A-01 | Files with `prettier/prettier` findings | Formatting drift | Apply deterministic Prettier-compatible formatting only to files with reported formatting findings. | None intended | None | None | None | Low | Revert formatting commit | `npx eslint ...`, `npm run build` | Prettier findings reduced to zero without logic changes | One formatting-only commit |
| 1A-02 | `src/platform-tools/platform-tools.controller.ts`, `src/platform-tools/platform-tools.service.ts` | Unused variable/import | Remove unused parameter/import or mark intentionally unused using project convention. | None intended | None | None | None | Low | Revert lint cleanup commit | `npx eslint ...`, `npm run build` | `no-unused-vars` findings resolved | Same deterministic lint commit as 1A-01 or separate tiny commit |
| 1A-03 | `src/platform-tools/maintenance.middleware.ts` | Unnecessary type assertion | Remove assertion if type remains unchanged. | None intended | None | None | None | Low | Revert lint cleanup commit | `npx eslint ...`, `npm run build` | `no-unnecessary-type-assertion` resolved | Same deterministic lint commit |

## Batch 1B: Type-Safety and Unsafe-Access Findings

Goal: reduce unsafe `any` at security, workflow, API, and test boundaries without changing route behavior.

| ID | Affected File or Module | Root Cause | Proposed Change | Runtime Behavior Impact | Tenant-Isolation Impact | RBAC/Auth Impact | Database Impact | Risk | Rollback Method | Required Tests | Acceptance Criteria | Recommended Commit Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1B-01 | `src/auth/auth.controller.ts`, current-user decorator, roles guard | Untyped request and user context | Introduce/reuse typed request interfaces for `req.ip`, headers, and authenticated user context. | None intended | Positive static assurance | Positive static assurance | None | Medium | Revert auth typing commit | Auth e2e, RBAC-related tests, build, lint | Auth route responses and status codes unchanged; unsafe request findings resolved | Auth boundary typing commit |
| 1B-02 | DTO validation decorators | Class-validator callback values inferred as `any` | Add narrow callback value types or helper validators. | None intended | None | Positive for input validation assurance | None | Low-Medium | Revert DTO typing commit | DTO-related tests, auth/onboarding tests, lint | Validation behavior unchanged; unsafe return findings resolved | DTO typing commit |
| 1B-03 | `src/report/report.service.ts`, `src/report/report-workflow.ts` | Untyped Prisma delegates, JSON fields, broad string unions | Add typed wrappers/narrowing and refine unions without changing accepted values. | None intended | Positive static assurance for report scoping | Positive where report permissions use user context | None | Medium-High | Revert report typing commit | Report workflow e2e, report unit tests, build, lint | Report API behavior unchanged; unsafe report findings materially reduced | Report typing commit |
| 1B-04 | Platform configuration and platform modules services | Broad unions and unsafe metadata normalization | Narrow metadata parsing and role/module state types. | None intended | Positive for module metadata tenant boundaries | Positive for role-aware module access | None | Medium | Revert platform typing commit | Platform configuration e2e, organization management e2e, lint | Future modules remain metadata-only; existing responses compatible | Platform typing commit |
| 1B-05 | E2E test response bodies | Supertest body inferred as `any` | Add local response interfaces or typed helper accessors in tests. | Test-only | Positive, clearer tenant assertions | Positive, clearer auth assertions | None | Medium | Revert test typing commit | Full Jest/e2e suites, lint | Unsafe test response access substantially reduced; tests still pass | Test typing commit |
| 1B-06 | Async helpers with no await and promise handling | `require-await`, `no-floating-promises`, `no-misused-promises` | Remove unnecessary `async`, await/void promises where behavior is unchanged. | None intended | None | None | None | Medium | Revert promise-handling commit | Build, tests, lint | Promise lint findings resolved without lifecycle regression | Promise cleanup commit |

## Batch 1C: Unit-Test Isolation and Fixture Stabilization

Goal: make test state reliable after interrupted or failed runs.

| ID | Affected File or Module | Root Cause | Proposed Change | Runtime Behavior Impact | Tenant-Isolation Impact | RBAC/Auth Impact | Database Impact | Risk | Rollback Method | Required Tests | Acceptance Criteria | Recommended Commit Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1C-01 | Test fixtures across auth, trust, report workflow, rate limiting | Static emails and suite-local cleanup can leave residue if setup aborts. | Add deterministic pre-test cleanup and/or unique run identifiers scoped to test-owned data. | Test-only | Positive; reduces false tenant failures | Positive; reduces false auth failures | Deletes only test-owned non-production records | High | Revert fixture isolation commit | `npm test -- --runInBand` twice | Full suite repeats without unique constraint contamination | Test isolation commit |
| 1C-02 | `afterAll` and `afterEach` cleanup patterns | Cleanup can miss partially created records. | Ensure cleanup handles partial setup and child records in dependency order. | Test-only | Positive | Positive | Deletes only test-owned records | High | Revert cleanup-order commit | Targeted auth/trust/report/rate-limit tests | Cleanup is idempotent and safe after failed setup | Cleanup order commit |
| 1C-03 | Test helper duplication | Each suite owns separate cleanup patterns. | Introduce shared test-owned cleanup helpers if scope remains small and clear. | Test-only | Positive | Positive | Test-only DB cleanup | Medium | Revert helper commit | Full Jest/e2e suites | Shared helper reduces duplication without broad refactor | Optional helper commit |

## Batch 1D: E2E Database Isolation and Migration-Safety Procedure

Goal: verify database target safety before any migration status command and before Tranche 2.

| ID | Affected File or Module | Root Cause | Proposed Change | Runtime Behavior Impact | Tenant-Isolation Impact | RBAC/Auth Impact | Database Impact | Risk | Rollback Method | Required Tests | Acceptance Criteria | Recommended Commit Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1D-01 | Documentation and validation checklist | Non-production DB target not verified for migration status. | Document how to verify DB host/name/environment before running safe migration status. | None | Positive data-safety control | None | Prevents accidental production checks | High | Revert documentation commit | `npx prisma validate`; no migration command until verified | Procedure approved by owner | Migration-safety docs commit |
| 1D-02 | E2E validation process | Test DB reuse can hide contamination. | Require repeat test run against verified non-production DB after cleanup changes. | None | Positive | Positive | Non-production only | Medium | Revert validation note | Full e2e twice | Repeatability evidence recorded | Validation process commit |
| 1D-03 | Safe migration status | Drift/status check skipped pending safe target. | Run only `prisma migrate status` after target is verified non-production; do not deploy/dev/reset. | None | Indirect | None | Read-only status check against non-production | Medium | No schema rollback; document result | `npx prisma validate`, safe status check if approved | Status recorded without mutation | Separate validation evidence commit |

## Batch 1E: Authentication, RBAC, Tenant-Isolation, and Report-Workflow Regression Fixes

Goal: only after lint and fixture stability work, correct any remaining true regression exposed by tests.

| ID | Affected File or Module | Root Cause | Proposed Change | Runtime Behavior Impact | Tenant-Isolation Impact | RBAC/Auth Impact | Database Impact | Risk | Rollback Method | Required Tests | Acceptance Criteria | Recommended Commit Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1E-01 | Auth and RBAC tests/services if failures recur | Prior baseline showed auth status mismatches and login failures. | Investigate after clean fixtures; change runtime only if a true defect remains. | Possible, only if approved | Possible | Direct | None expected | High | Revert focused auth/RBAC fix | Auth e2e, RBAC matrix, build, lint | Existing auth status codes and DTOs remain compatible | One focused auth/RBAC fix commit if needed |
| 1E-02 | Tenant isolation tests/services if failures recur | Prior foreign-key failures obscured tenant checks. | Add or fix tenant assertions only after DB isolation is stable. | Possible, only if approved | Direct | Direct where roles intersect | None expected | High | Revert focused tenant fix | Tenant matrix, trust e2e, report workflow e2e | Cross-tenant denial and super-admin access remain explicit | One focused tenant fix commit if needed |
| 1E-03 | Report workflow tests/services if failures recur | Prior unique constraint failures blocked workflow assertions. | Fix fixture setup first; runtime changes only if workflow defect is proven. | Possible, only if approved | Direct through report organization scope | Direct through role workflow transitions | None expected | High | Revert focused workflow fix | Report workflow e2e, report unit tests | `Report` lifecycle remains compatible and stable | One focused workflow fix commit if needed |
| 1E-04 | Rate limiting tests/config if failures recur | Prior rate-limit suite failed during setup. | Confirm thresholds and fixture isolation; tune only if legitimate flow is blocked. | Possible, only if approved | None | Direct for auth/login throttling | None | Medium-High | Revert rate-limit tuning commit | Rate-limiting e2e, auth e2e | Normal authenticated requests pass; abusive flows throttle as expected | One focused rate-limit commit if needed |

## Batch 1F: Full Validation and Tranche 1 Exit Review

Goal: close Tranche 1 only after validation is clean or explicitly waived.

| ID | Affected File or Module | Root Cause | Proposed Change | Runtime Behavior Impact | Tenant-Isolation Impact | RBAC/Auth Impact | Database Impact | Risk | Rollback Method | Required Tests | Acceptance Criteria | Recommended Commit Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1F-01 | Validation evidence | Tranche 1 requires reproducible proof. | Rerun full baseline commands and targeted security boundary tests. | None | Confirms | Confirms | Confirms non-production procedure | Medium | Revert docs if inaccurate | Full command set | All gates pass or waivers are explicit | Validation report commit |
| 1F-02 | Tranche 1 exit report | Need decision before Tranche 2. | Document completed batches, residual risks, rollback state, and Tranche 2 readiness. | None | Documents | Documents | Documents | Low | Revert docs if inaccurate | N/A | Exit conditions recorded | Tranche 1 exit docs commit |

## Recommended Execution Order

1. Batch 1A: formatting and unused-symbol cleanup.
2. Batch 1B: type-safety and unsafe-access cleanup.
3. Batch 1C: fixture and cleanup repeatability.
4. Batch 1D: non-production DB verification and migration-status procedure.
5. Batch 1E: only true runtime/test regressions still exposed after cleanup.
6. Batch 1F: full validation and exit review.

## Conditions Before Starting Remediation

- Confirm remediation remains on `phase-4-platform-expansion` or an approved non-production Tranche 1 branch.
- Confirm no production branch, push, merge, deployment, service restart, package update, migration, seed, reset, or production DB activity is authorized.
- Confirm the first remediation commit is Batch 1A and is limited to deterministic lint/formatting cleanup.

## Final Recommendation

Start with **Batch 1A: Formatting and deterministic lint corrections**.

Proceed to Batch 1B only after Batch 1A is reviewed and the lint delta confirms no behavior-bearing changes were mixed into formatting cleanup.
