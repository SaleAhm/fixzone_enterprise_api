# Phase 7 Implementation Roadmap

## Tranche 7B — Critical Workflow and Regression Stabilization

Goal: restore backend regression confidence and verify critical cross-role workflows.

Scope:

1. Fix failing backend auth, rate-limiting, platform backup and demo-environment tests.
2. Run authenticated role smoke for citizen, provider, org admin and super admin.
3. Verify report lifecycle end-to-end: citizen report → dispatch → provider accept/complete → citizen review → admin oversight.
4. Verify audit logs for assignment, completion, KYC, dispute and platform-tool actions.
5. Verify tenant isolation with direct API/route attempts.

Exit criteria:

- Backend `npm test` and `npm run test:e2e` pass.
- Authenticated smoke is documented with screenshots.
- No critical workflow blockers remain.

## Tranche 7C — Cross-Role UI Polish and Design-System Normalization

Goal: make the app feel consistently premium for real citizens, technicians, organization operators and platform admins.

Scope:

1. Remove/replace placeholder labels and RC wording.
2. Simplify technical readiness/module metadata language.
3. Normalize IDs, status labels, dates, currency and empty/error states.
4. Capture responsive screenshots at 320, 375, 768, 1024, 1440 and wide desktop.
5. Improve critical action feedback beyond SnackBars.

Exit criteria:

- No visible dead controls or unexplained metadata-only controls.
- Authenticated screens pass responsive review.

## Tranche 7D — Operational Backup, Restore, Export and DR Tooling

Goal: turn infrastructure evidence into safe operator tooling.

Scope:

1. Fix backup creation regression.
2. Add backup status, size, location, retention and verification metadata.
3. Add safe audit/log export with filters.
4. Design restore/download UX with explicit authorization, pre-restore backup and rollback plan.
5. Complete HPE ML30 off-site replication evidence.

Exit criteria:

- Backup create/list/delete pass e2e.
- Restore/download remain disabled until safety gates are complete.
- DR status visible and accurate.

## Tranche 7E — Executive Analytics and Monetization Maturity

Goal: make analytics and billing claims defensible for clients and investors.

Scope:

1. Add metric definitions and denominator explanations.
2. Reconcile active/resolved/closed counts.
3. Add date filters and export-ready analytics.
4. Remove placeholder revenue language or connect real billing data.
5. Implement or formally defer payment gateway, invoice download and statements.

Exit criteria:

- Monetary figures are classified live/derived/manual/placeholder in UI.
- Analytics definitions are visible and accurate.

## Tranche 7F — Accessibility, Performance and Final Enterprise Polish

Goal: close enterprise non-functional gaps.

Scope:

1. Full accessibility audit of Flutter and website.
2. Performance review for large reports/users/providers lists.
3. Dependency vulnerability/outdated package review.
4. Session/device management hardening.
5. Final production runbook and support-tool polish.

Exit criteria:

- Accessibility issues triaged by severity.
- Dependency upgrade plan approved.
- Production support workflows documented.

