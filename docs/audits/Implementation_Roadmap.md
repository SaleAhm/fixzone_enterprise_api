# Implementation Roadmap After Audit

Date: 2026-07-09  
Status: Recommendation only. No implementation performed in this audit phase.

## Guiding Principles

1. Preserve production first.
2. Preserve milestone work second.
3. Do not activate future modules accidentally.
4. Do not rename `Report` or migrate report data without a dedicated migration phase.
5. Keep Maintenance Services / FixZone fully functional.
6. Require validation evidence before every release promotion.

## Phase 0: Baseline Protection

Priority: Critical

Actions:

- Determine exact live production commits for backend, frontend and website.
- Tag production Baseline A.
- Tag current milestone Baseline B.
- Commit/preserve Phase 5E docs work in `securezone-platform`.
- Push local milestone commits to remote.
- Create a release baseline matrix.

Exit criteria:

- No valuable work exists only on one machine without a tag/remote copy.
- Production baseline is auditable.

## Phase 1: Controlled Merge Preparation

Priority: Critical

Actions:

- Create release-candidate branches.
- Merge milestone branches through PRs.
- Keep commit history traceable.
- Review migrations before deploy.
- Verify future modules remain metadata-only.

Exit criteria:

- Backend/frontend/docs milestone work exists on RC branches.
- No destructive merge conflicts unresolved.

## Phase 2: Validation and Smoke Testing

Priority: High

Actions:

- Backend:
  - `npx prisma validate`
  - `npx prisma generate`
  - `npm run build`
  - `npm test -- --runInBand`
  - `npm run test:e2e -- --runInBand`
- Flutter:
  - `dart format .` as implementation-phase action only
  - `flutter analyze`
  - `flutter test`
  - `flutter build web --release`
- Website:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`

Manual smoke:

- Citizen submits report.
- Admin assigns provider.
- Provider accepts and completes.
- Citizen validates.
- Super admin sees updated platform state.
- Provider login works with email and PRV ID if supported.
- Admin mobile pages show no overflow.
- Future modules remain locked/metadata-only.

Exit criteria:

- Test results are attached to release notes.

## Phase 3: Production Operational Evidence

Priority: High

Actions:

- Verify Dokploy service configuration.
- Verify environment variables without exposing secrets.
- Verify PostgreSQL migration state.
- Verify backup schedule.
- Run restore drill or document last restore evidence.
- Verify monitoring/alerts.
- Verify SSL/domain status.

Exit criteria:

- Operations evidence is stored in docs or release artifacts.

## Phase 4: Security Hardening

Priority: High

Actions:

- Add rate limiting/throttling.
- Harden upload validation and scanning.
- Review debug logging.
- Add secret rotation checklist.
- Review organization scoping on every endpoint.
- Review Trust/Records/Disputes access controls.

Exit criteria:

- Security hardening tests and review checklist completed.

## Phase 5: Website Production Polish

Priority: Medium

Actions:

- Integrate real contact form delivery.
- Add SEO metadata and structured data.
- Add analytics/cookie privacy posture.
- Run Lighthouse/accessibility audit.
- Optimize images.

Exit criteria:

- Website build/lint/typecheck pass.
- Contact and SEO are production-ready.

## Phase 6: Observability and Workflow Intelligence

Priority: Medium

Actions:

- Add admin workflow-event inspection.
- Persist analytics events if needed.
- Add notification delivery status indicators.
- Add provider/organization operational health views.

Exit criteria:

- Admins can diagnose workflow and notification issues without database access.

## Phase 7: Future Module Readiness

Priority: Future

Actions:

- Continue module readiness and activation governance.
- Do not build healthcare, legal, ICT, agriculture, education, property or security workflows until Maintenance/FixZone and platform runtime are fully stable.
- Before activating any module, require:
  - workflow specification,
  - data model review,
  - access model review,
  - subscription model review,
  - tests,
  - pilot plan,
  - rollback plan.

Exit criteria:

- Future module activation is evidence-led, not metadata-led.

## Recommended Next Phase

Before Phase 5F or any new implementation:

1. Approve this audit.
2. Preserve baselines.
3. Merge milestone work safely.
4. Run full validation.
5. Capture production operational evidence.

Only then begin Phase 5F.

## Release Readiness Addendum

Date: 2026-07-09

The regression risk assessment adds a mandatory pre-stabilization gate before any implementation phase.

Updated recommended order:

1. Approve Enterprise Audit and Regression Risk Assessment.
2. Capture exact production commit hashes and database migration level.
3. Tag Baseline A production.
4. Tag Baseline B milestone work.
5. Preserve and commit documentation Phase 5E work.
6. Push backend and frontend milestone branches.
7. Create release-candidate integration branches.
8. Merge in controlled tranches.
9. Run complete regression testing.
10. Deploy to staging.
11. Run manual portal/UAT smoke tests.
12. Deploy to production during a monitored window.
13. Monitor and keep rollback ready for 24-48 hours.

Do not start Phase 5F, Phase 1 Enterprise Stabilization implementation, or any new module work until these prerequisites are complete.
