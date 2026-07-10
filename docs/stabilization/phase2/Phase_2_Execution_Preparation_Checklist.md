# Phase 2 Execution Preparation Checklist

Date: 2026-07-09

## Purpose

This checklist prepares Phase 2 execution without starting implementation. It is based on the Phase 2 entry governance review, the Phase 2 implementation roadmap, and Phase 1 stabilization results.

## Required Prerequisites Before Implementation

- Phase 1 commits reviewed by branch owners.
- Phase 1 merge order approved.
- Phase 1 rollback owners identified for backend, frontend, and website runtime commits.
- Decision made for remaining untracked Phase 1 docs: commit, archive, or discard.
- Phase 2 first tranche selected and approved in writing.
- Phase 2 branch names confirmed for backend, frontend, and website if needed.
- No production branch work begins without release-owner approval.
- No production database changes begin without migration governance approval.

## Branch Readiness Verification

Backend:

- Confirm current backend branch before implementation.
- Confirm Phase 1 backend commits are present.
- Confirm no unrelated source changes are pending.
- Confirm untracked Phase 1 docs are intentionally preserved or resolved.
- Confirm Phase 2 branch is created from the approved Phase 1 baseline.

Frontend:

- Confirm current frontend branch before implementation.
- Confirm Phase 1 frontend stabilization commit is present.
- Confirm working tree is clean before Phase 2 frontend work.
- Confirm Phase 2 branch is created from the approved frontend baseline.

Website:

- Confirm current website branch before implementation.
- Confirm Phase 1 website stabilization commit is present.
- Confirm working tree is clean before website-impacting Phase 2 work.
- Create a Phase 2 website branch only if website changes are required.

## Documentation Readiness Verification

- `Phase_2_Entry_Governance_Review.md` is committed.
- `Phase_2_Implementation_Roadmap.md` is committed.
- This execution preparation checklist is reviewed before implementation begins.
- Remaining Phase 1 docs have an owner decision.
- Each Phase 2 tranche has a planned design note, test plan, rollback note, and validation report.
- Documentation does not claim activation of future modules before workflow approval.
- Maintenance/FixZone compatibility remains an explicit acceptance criterion in every tranche.

## Dependency Review Requirements

- Do not install or update dependencies as part of a feature tranche unless explicitly approved.
- Review backend dependency warnings before implementation, especially the existing `pg` deprecation warning.
- Review website Browserslist freshness separately from feature delivery.
- Record dependency changes in a dedicated dependency-maintenance note if any are approved.
- Re-run full validation after dependency changes.
- Avoid mixing dependency upgrades with evidence delivery, entitlement, or framework expansion work.

## Regression Preparation Requirements

Backend baseline commands:

- `npx prisma validate`
- `npx prisma generate`
- `npm run build`
- `npm test -- --runInBand`
- `npm run test:e2e -- --runInBand`

Frontend baseline commands:

- `flutter analyze`
- `flutter test`
- `flutter build web --release`

Website baseline commands:

- `npm run build`
- `npm run typecheck`
- `npm run lint`

Tranche-specific regression preparation:

- Evidence delivery: prepare access matrix coverage for citizen, provider, org admin, super admin, unrelated user, and unauthenticated user.
- Upload lifecycle: prepare tests for valid files, rejected files, scanner unavailable behavior, size limits, dimension limits, and old evidence references.
- Rate-limit observability: prepare tests for expected `429` behavior and non-throttled authorized flows.
- Module entitlements: prepare tests for `allowed`, `locked`, and `hidden` states.
- Enterprise service framework: prepare compatibility tests proving existing `Report` workflows remain unchanged.

## Migration Governance Requirements

- Default Phase 2 position: no migrations.
- Any migration requires a separate approval note before implementation.
- Migration approval must include purpose, affected tables, data impact, rollback approach, and staging validation plan.
- Prefer additive nullable fields or new tables.
- Do not rename `Report`.
- Do not split existing report tables.
- Do not move existing report evidence without a dedicated evidence migration plan.
- Do not alter production database state without release-owner authorization.

## Rollback Preparation Requirements

- Identify the exact commit or feature flag to revert for each tranche before implementation starts.
- Preserve compatibility paths for existing Maintenance/FixZone behavior.
- Keep legacy evidence references readable during protected evidence delivery work.
- Define emergency disablement or tuning controls for rate-limit changes.
- Define scanner bypass or fail-closed/fail-open behavior before upload scanning implementation.
- Document validation commands required after rollback.
- Keep rollback notes close to each tranche report.

## Recommended Implementation Order by Tranche

1. Phase 1 merge and governance baseline.
2. Evidence delivery and upload lifecycle.
3. Rate-limit observability and operational tuning.
4. Module entitlements and access enforcement foundation.
5. Enterprise service framework expansion.
6. Dependency and technical debt cleanup.

Implementation rules:

- Complete one tranche before beginning the next.
- Keep each tranche independently reviewable and reversible.
- Do not activate future non-maintenance modules in production during these tranches.
- Treat Maintenance/FixZone compatibility as a blocking gate.

## Phase 2 Entry Approval Checklist

- [ ] Branch owners reviewed Phase 1 local commits.
- [ ] Phase 1 merge order approved.
- [ ] Runtime rollback owners assigned.
- [ ] Remaining untracked Phase 1 docs disposition approved.
- [ ] Phase 2 baseline branches selected.
- [ ] First Phase 2 tranche selected.
- [ ] First tranche design note approved.
- [ ] First tranche rollback note approved.
- [ ] First tranche validation plan approved.
- [ ] Migration impact assessed.
- [ ] Dependency impact assessed.
- [ ] Maintenance/FixZone compatibility acceptance criteria documented.
- [ ] No production branch, deployment, merge, push, service restart, migration, or production database change is scheduled without explicit release authorization.

## Execution Gate

Phase 2 implementation should not begin until every item in the Phase 2 entry approval checklist is either completed or explicitly waived by the responsible branch or release owner.
