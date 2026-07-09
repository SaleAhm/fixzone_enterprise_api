# Phase 2 Implementation Roadmap

Date: 2026-07-09

## Objective

Phase 2 should expand SecureZone toward a controlled enterprise platform while preserving the existing Maintenance/FixZone production foundation. The goal is to convert the Phase 4A-4C metadata, access, and enterprise-service framework into governed, testable platform expansion paths without breaking current report, dispatch, provider, citizen, trust, subscription, notification, or admin workflows.

## Scope

Phase 2 may include:

- Protected evidence delivery design and implementation behind explicit access controls.
- Upload scanning and image validation improvements beyond Phase 1 MIME/signature hardening.
- Rate-limit observability, tuning, and operational reporting.
- Module entitlement governance for future services, keeping Maintenance as the only active production workflow until separately approved.
- Module-aware provider capabilities, navigation, analytics, and access checks that default to non-breaking behavior.
- Staging-only validation of future module metadata and enterprise service definitions.
- Cleanup of known Phase 1 follow-up risks, including the backend `pg` deprecation warning and website dependency metadata freshness.

## Non-Scope

Phase 2 should not include:

- Renaming `Report` or migrating existing report data into new service tables.
- Activating Healthcare, Legal, ICT, Agriculture, Property, Security, Education, or other future workflows in production.
- Replacing Maintenance/FixZone as the active production module.
- Broad database redesign without a separate migration approval package.
- Production deployment, production database changes, or production branch work without release authorization.
- Combining unrelated hardening, platform expansion, and UI redesign in one tranche.

## Recommended Implementation Tranches

### Tranche 1: Phase 1 Merge and Governance Baseline

- Review and merge Phase 1 commits in the approved order from `Phase_2_Entry_Governance_Review.md`.
- Decide whether to commit or archive remaining untracked Phase 1 docs.
- Create approved local governance tags after final Phase 1 commit targets are confirmed.
- Re-run backend, frontend, and website validation after merges.

Exit gate:

- Phase 1 governance artifacts are committed or explicitly archived.
- Branch owners approve the Phase 2 working baseline.

### Tranche 2: Evidence Delivery and Upload Lifecycle

- Design protected or signed evidence delivery for existing `/uploads` references.
- Add access checks for evidence retrieval without invalidating existing report records.
- Add malware scanning strategy and image dimension validation plan.
- Add upload rejection logging and operator-facing metrics.

Exit gate:

- Existing evidence remains accessible through an approved compatibility path.
- New evidence access is covered by backend unit and e2e tests.

### Tranche 3: Rate-Limit Observability and Operational Tuning

- Add reporting around `429` rates by route class, actor, organization, and environment.
- Confirm upload, auth, onboarding, notification, admin, and public endpoint thresholds against staging behavior.
- Document emergency tuning or disablement steps per rate-limit profile.

Exit gate:

- Operators can distinguish abusive traffic from legitimate retry-heavy traffic.
- Rate-limit rollback and tuning instructions are documented.

### Tranche 4: Module Entitlements and Access Enforcement Foundation

- Build explicit organization-level module entitlement records or policy objects if approved.
- Keep Maintenance permissive and active.
- Keep future modules locked or metadata-only until activation criteria are approved.
- Add audit evidence for module entitlement changes and access denials.

Exit gate:

- Future modules remain non-production.
- Existing Maintenance routes and workflows are unchanged.

### Tranche 5: Enterprise Service Framework Expansion

- Extend service definitions, provider capabilities, and adapters without replacing existing report workflows.
- Add dynamic or backend-fed navigation only where it can preserve existing route contracts.
- Add analytics contracts that read current Maintenance data through compatibility adapters.

Exit gate:

- Framework additions are read-only or non-blocking unless separately approved.
- Maintenance adapter remains the source of truth for current report workflows.

### Tranche 6: Dependency and Technical Debt Cleanup

- Resolve the backend `pg` deprecation warning.
- Refresh website Browserslist metadata through a controlled dependency-maintenance task.
- Review remaining Phase 1 technical debt register items and decide whether they are Phase 2 or later.

Exit gate:

- Dependency and warning cleanup is independently validated and does not alter product behavior.

## Branching Strategy

- Keep Phase 2 work on non-production branches.
- Recommended backend branch: `phase-2-enterprise-platform-expansion`.
- Recommended frontend branch: `phase-2-enterprise-platform-expansion`.
- Recommended website branch: `phase-2-website-governance` only if website changes are needed.
- Use tranche-specific topic branches for implementation, for example:
  - `phase-2/evidence-delivery`
  - `phase-2/rate-limit-observability`
  - `phase-2/module-entitlements`
  - `phase-2/service-framework-expansion`
- Require branch-owner review before merging tranche branches into the Phase 2 integration branch.
- Do not push tags or merge to production branches without release-owner approval.

## Validation Strategy

Backend baseline validation for every tranche:

- `npx prisma validate`
- `npx prisma generate`
- `npm run build`
- `npm test -- --runInBand`
- `npm run test:e2e -- --runInBand`

Frontend baseline validation for frontend-impacting tranches:

- `flutter analyze`
- `flutter test`
- `flutter build web --release`

Website baseline validation for website-impacting tranches:

- `npm run build`
- `npm run typecheck`
- `npm run lint`

Additional tranche-specific validation:

- Evidence delivery: authorization matrix tests for citizen, provider, org admin, super admin, and unrelated users.
- Upload lifecycle: valid and rejected upload cases, scanner unavailable behavior, file size and dimension limits.
- Rate-limit observability: route-specific throttling tests and log/metric assertions where practical.
- Module entitlements: access-state tests for `allowed`, `locked`, and `hidden`.
- Enterprise framework: adapter compatibility tests proving existing `Report` workflows remain unchanged.

## Migration Rules

- Default to no migrations unless a tranche has explicit migration approval.
- Any migration must include:
  - written purpose and data impact;
  - backward-compatibility assessment;
  - rollback plan;
  - staging validation plan;
  - production data-safety checklist.
- Do not rename `Report`, split existing report tables, or move existing report evidence in Phase 2 without a separate architecture approval.
- Prefer additive nullable columns or new tables over destructive changes.
- Keep legacy `/uploads/...` references readable until protected delivery migration is proven.

## Rollback Strategy

- Keep Phase 1 rollback commits documented and available until Phase 2 staging verification is complete.
- Each Phase 2 tranche must have a dedicated rollback section before implementation starts.
- Prefer feature flags or configuration gates for new enforcement behavior.
- For protected evidence delivery, preserve a compatibility mode for existing records.
- For rate-limit tuning, maintain documented emergency threshold overrides.
- For module entitlements, default future modules to locked/metadata-only if policy evaluation fails.
- Re-run the relevant validation command set after any rollback.

## Required Reports and Checklists

Before Phase 2 implementation:

- Phase 2 tranche approval note.
- Branch baseline status report.
- Remaining Phase 1 docs disposition decision.

For each implementation tranche:

- Design note.
- Risk and rollback note.
- Test plan.
- Validation report.
- Merge readiness checklist.

Before Phase 2 closure:

- Phase 2 regression report.
- Migration report, if migrations were used.
- Security review update.
- Operational monitoring checklist.
- Phase 2 completion report.
- Phase 3 authorization review, if further expansion is proposed.

## Phase 2 Exit Criteria

Phase 2 can close only when:

- Maintenance/FixZone production workflows remain compatible and validated.
- Approved Phase 2 tranches are complete, tested, and documented.
- No future module is active in production unless separately approved with full workflow and rollback evidence.
- Evidence delivery, upload lifecycle, or rate-limit changes have staging validation and rollback notes.
- Backend, frontend, and website validation commands pass for impacted repositories.
- Any migrations are additive, reviewed, validated, and documented.
- Remaining risks are documented with owner decisions.
- Branch owners approve merge and release readiness.

## Implementation Hold

This roadmap does not authorize implementation by itself. Phase 2 implementation should start only after branch-owner review, tranche selection, and explicit approval for the first tranche.
