# Phase 2 Tranche 1 Execution Backlog

Date: 2026-07-10

## Purpose

This backlog defines the implementation-ready scope for Phase 2 Tranche 1. It does not implement runtime changes, authorize package installation, create migrations, apply migrations, push, merge, deploy, restart services, modify production branches, or touch production databases.

## A. Tranche 1 Objective

Tranche 1 is the minimum safe foundation required before SecureZone enterprise feature expansion. Its purpose is to convert the completed governance baseline into a validated, reversible execution baseline by confirming production and rollback references, resolving baseline quality-gate conditions, strengthening tenant-isolation and RBAC safeguards, protecting API compatibility, preparing database and migration safety controls, and establishing regression-test and audit traceability foundations for later tranches.

Tranche 1 must preserve Maintenance/FixZone as the active production workflow and keep `Report` as the source-of-truth workflow entity.

## B. Exact Scope

Scope is based on the committed Phase 2 roadmap, tranche tracker, governance reports, Phase 1 recommendations, and repository validation performed during implementation preparation.

Included foundational work:

- Confirm production, rollback, governance, preparation, and execution baseline references.
- Resolve approved technical-debt prerequisites that block reliable validation.
- Strengthen tenant-isolation guardrails for existing Maintenance/FixZone workflows.
- Strengthen RBAC and authentication safeguards for existing roles.
- Add API compatibility protection for existing report, auth, evidence, notification, organization, trust, and platform metadata surfaces.
- Establish database and migration safety foundations without applying migrations unless separately approved.
- Stabilize regression-test setup and isolation for auth, RBAC, tenant isolation, reports, evidence, rate limiting, and trust workflows.
- Add audit and traceability checkpoints required by later tranches.
- Maintain documentation and validation checkpoints after each batch.

Current validation basis:

- `npx prisma validate`: passed.
- `npm run build`: passed.
- `npx eslint "{src,apps,libs,test}/**/*.ts"`: failed on existing lint, type-safety, and formatting findings.
- `npm test -- --runInBand`: failed in DB-backed auth, trust, report workflow, and rate-limiting e2e suites, primarily unique constraint and foreign-key setup failures, plus observed auth status mismatches.
- `npm run test:e2e -- --runInBand`: failed in DB-backed auth, trust, report workflow, and rate-limiting suites, primarily unique constraint, foreign-key setup, and authentication status mismatches.
- Migration drift detection was not run because the database target could not be safely verified as non-production from the local environment without exposing sensitive configuration.

## C. Work-Item Table

| ID | Title | Problem Being Addressed | Reason It Belongs in Tranche 1 | Files or Modules Likely Affected | Dependencies | Tenant-Isolation Impact | RBAC/Authentication Impact | API Compatibility Impact | Database or Migration Impact | Risk Level | Rollback Approach | Required Tests | Acceptance Criteria | Documentation Deliverable | Recommended Implementation Order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1-01 | Baseline Reference Verification | Production, rollback, governance, and execution references must be explicit before runtime work. | Later tranches need stable revert and audit anchors. | `docs/stabilization/phase2`, git tags only if approved | Completed governance docs and local tags | None | None | None | None | Low | Revert documentation-only commit; do not move tags without approval | `git status`, `git tag --list`, `git rev-parse` checks | Current branch, HEAD, ahead/behind, governance tags, rollback commits, and production tag are recorded | Baseline reference note or update to Tranche 1 validation report | 1 |
| T1-02 | Validation Baseline Cleanup Plan | Lint and DB-backed tests are not clean in the current local state. | Reliable validation is required before feature expansion. | `eslint.config.mjs`, affected `src/**`, `test/**` only after approval | T1-01 | Indirect; test reliability protects tenant checks | Indirect; test reliability protects auth checks | None unless formatting exposes DTO/API issue | No migrations; may require test data cleanup only | High | Revert focused cleanup commits independently | Non-mutating lint, build, unit/e2e suites | Agreed list of lint/test failures is triaged into fix, defer, or waiver before runtime feature work | Validation cleanup triage note | 2 |
| T1-03 | Test Database Isolation Foundation | Current tests fail with unique constraint and foreign-key setup errors, indicating contaminated or insufficiently isolated DB state. | Auth, RBAC, tenant, report, trust, and rate-limit regression gates depend on repeatable DB-backed tests. | `test/**`, test setup helpers, Prisma test utilities | T1-02 | High positive impact; cross-tenant assertions become repeatable | High positive impact; role/login fixtures become reliable | None | No schema migration by default; test cleanup may delete only test-owned data in non-production DB | High | Revert test-helper changes; keep fixtures scoped by deterministic test prefixes | `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`, targeted auth/trust/report/rate-limit specs | DB-backed tests can run repeatedly without unique constraint or foreign-key contamination | Test isolation design and validation note | 3 |
| T1-04 | Tenant-Isolation Regression Matrix | Tenant rules are distributed across services and must remain stable before module expansion. | Future platform work must not weaken Maintenance/FixZone tenant boundaries. | `test/**`, report, organization, trust, platform configuration services if gaps are found | T1-03 | Direct; verifies org/user/provider/report/evidence boundaries | Direct where role scopes intersect tenant access | Existing APIs must preserve response shape and status semantics | No migration by default | High | Revert tests or targeted guard changes independently | Cross-organization negative tests; super-admin positive tests; provider assignment tests | Org A cannot access Org B data; provider and citizen boundaries remain enforced; super-admin global access remains explicit | Tenant isolation matrix update | 4 |
| T1-05 | RBAC and Authentication Regression Matrix | Existing role access must be protected before evidence, entitlement, or service-framework changes. | Later tranches rely on stable auth and role gates. | `src/auth`, guards/decorators, controllers, `test/auth*.spec.ts` | T1-03 | Direct where organization-scoped roles are tested | Direct; covers citizen, provider, pending provider, org admin, dispatch, super admin | Existing auth endpoints and status codes must remain compatible | No migration by default | High | Revert role/auth changes; preserve previous route contracts | Login, provider ID login, reset, role denial, suspended account, admin invite tests | Each role has allowed and denied route coverage; existing clients receive compatible status codes and DTOs | RBAC/auth matrix update | 5 |
| T1-06 | API Compatibility Guardrails | Phase 2 must avoid accidental breaking changes to Maintenance/FixZone APIs. | Evidence, rate-limit, and entitlement tranches need compatibility protection. | Controller tests, DTO tests, OpenAPI/API notes if present | T1-03, T1-05 | Indirect | Indirect through protected endpoints | Direct; prevents removed fields, changed status codes, or renamed entities | None | Medium | Revert compatibility tests or DTO changes independently | Snapshot/contract-style assertions for critical endpoints where practical | Existing report, auth, evidence, organization, notification, trust, and metadata API responses remain additive-compatible | API compatibility checkpoint | 6 |
| T1-07 | Migration Safety and Drift Verification Procedure | Migration drift detection could not be safely run until the DB target is verified as non-production. | Later persistence work needs a safe procedure before any schema change. | `docs/stabilization/phase2`, Prisma operational notes | T1-01 | Indirect; protects tenant data | None | None | Procedure only; no migration unless separately approved | High | Revert documentation/procedure commit | `npx prisma validate`; safe `prisma migrate status` only against verified non-production DB | Non-production migration-status procedure is documented and approved; production data is never touched | Migration safety checklist | 7 |
| T1-08 | Audit and Traceability Foundation | Later tranches need clear evidence of who changed access, evidence, and platform controls. | Evidence delivery and entitlement work require auditability. | Audit log services/tests, documentation; runtime changes only if approved | T1-04, T1-05 | Positive where tenant context is logged safely | Positive where actor role is logged safely | No breaking API changes | No migration by default; migration requires separate approval | Medium | Revert audit additions independently; feature-flag if needed | Audit assertions for access-denied and privileged actions where existing model supports it | Critical access decisions have traceable actor, tenant, entity, and action context without secrets | Audit traceability note | 8 |
| T1-09 | Validation and Rollback Checkpoint Report | Each batch needs proof that it is independently reviewable and reversible. | This is the final gate before Tranche 2 evidence work. | `docs/stabilization/phase2` | T1-01 through T1-08 | Confirms tenant tests | Confirms RBAC/auth tests | Confirms compatibility tests | Confirms migration safety status | Medium | Revert documentation-only checkpoint if inaccurate | Full approved backend baseline validation; targeted frontend/website checks only if impacted | Tranche 1 exit criteria are met or remaining conditions are explicitly accepted | Tranche 1 validation and rollback report | 9 |

## D. Explicit Non-Scope

Deferred to later tranches or separate approval:

- Protected or signed evidence delivery implementation beyond Tranche 1 compatibility guardrails.
- Upload malware scanning implementation.
- Image dimension validation implementation.
- Broad enterprise registry or module marketplace implementation.
- Provider ecosystem expansion beyond existing Maintenance/FixZone safeguards.
- Intelligence, automation, analytics, or reporting expansion.
- Enterprise service framework feature expansion.
- Future module production activation.
- Healthcare, Legal, Agriculture, Education, ICT, Security, Property, or other future workflow implementation.
- Renaming, replacing, splitting, or migrating the `Report` source-of-truth workflow model.
- Production deployment, production branch activity, production database activity, service restart, push, merge, or release activity without explicit release approval.
- Dependency upgrades unless separately approved as a controlled maintenance task.

## E. Entry and Exit Gates

### Open Tranche 1

Required conditions:

- Phase 2 governance baseline is committed.
- Phase 2 implementation preparation report is committed.
- Phase 1 closure package is committed or explicitly excluded.
- Current branch, HEAD, remote tracking status, and tags are recorded.
- No unexpected runtime files are modified.
- Initial validation results are recorded, including failures.
- Tranche 1 backlog is committed.
- Tranche 1 owner is assigned.
- Branch/release owners accept that Tranche 1 opens with validation conditions.

### Complete Each Work Item

Required conditions:

- Work item is implemented in a small, reviewable batch.
- No unrelated files are touched.
- Tenant-isolation, RBAC/auth, API compatibility, database/migration, and rollback impacts are updated.
- Required tests for the work item pass or have an explicit owner waiver.
- Documentation deliverable is completed.
- Rollback approach is verified.

### Close Tranche 1

Required conditions:

- Baseline reference verification is complete.
- Lint/test baseline conditions are resolved or explicitly waived.
- Test DB isolation is repeatable against a verified non-production database.
- Tenant-isolation and RBAC/auth regression matrices are complete.
- API compatibility guardrails are in place for critical Maintenance/FixZone surfaces.
- Migration safety procedure is approved.
- Audit and traceability requirements for later tranches are documented.
- Full backend validation passes or remaining failures are explicitly accepted by branch/release owners.
- No unapproved migrations, package changes, production activity, or runtime deployments occurred.

### Proceed to Tranche 2

Required conditions:

- Tranche 1 is closed.
- Tranche 2 evidence delivery design is approved.
- Existing `/uploads/...` compatibility plan is approved.
- Evidence access matrix is approved for citizen, provider, org admin, dispatch, super admin, unrelated user, and unauthenticated user.
- Tranche 2 rollback note and validation plan are approved.
- Any migration impact is approved or explicitly confirmed as not applicable.

## F. Recommended Execution Batches

Batch 1: Baseline and validation triage

- T1-01 Baseline Reference Verification.
- T1-02 Validation Baseline Cleanup Plan.
- Output: small documentation and triage commit.

Batch 2: Test reliability foundation

- T1-03 Test Database Isolation Foundation.
- Output: focused test setup/helper commits with no product behavior changes unless explicitly approved.

Batch 3: Security boundary regression

- T1-04 Tenant-Isolation Regression Matrix.
- T1-05 RBAC and Authentication Regression Matrix.
- Output: focused regression tests and minimal fixes only where tests reveal approved defects.

Batch 4: Compatibility and migration safety

- T1-06 API Compatibility Guardrails.
- T1-07 Migration Safety and Drift Verification Procedure.
- Output: compatibility tests and migration safety documentation.

Batch 5: Traceability and closure

- T1-08 Audit and Traceability Foundation.
- T1-09 Validation and Rollback Checkpoint Report.
- Output: audit checks, final validation report, and Tranche 2 readiness decision.

## G. Final Readiness Recommendation

**READY TO OPEN TRANCHE 1 WITH CONDITIONS**

Rationale:

- Governance and preparation documentation are complete enough to open Tranche 1.
- Prisma schema validation and TypeScript build passed.
- No runtime files were modified during preparation.
- Secrets were not detected in the reviewed Phase 1 documentation.
- However, Tranche 1 must open with explicit validation conditions because non-mutating ESLint failed and DB-backed Jest/e2e validation failed in the current local state.

Opening conditions:

- Branch/release owners must accept Tranche 1 as a foundation-and-validation tranche, not a feature-expansion tranche.
- Lint findings must be triaged before runtime feature work.
- DB-backed test isolation must be resolved or formally waived before Tranche 2.
- Migration drift/status checks must be run only after a non-production database target is verified.
- No enterprise feature expansion should begin until Tranche 1 exit gates are satisfied.
