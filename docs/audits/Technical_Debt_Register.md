# Technical Debt Register

Date: 2026-07-09

## Summary

This register captures debt found during the documentation-only enterprise audit. It is not an implementation plan by itself; use `Implementation_Roadmap.md` for recommended sequencing.

## Register

| ID | Area | Priority | Debt | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- |
| TD-001 | Git | Critical | Production and milestone baselines are not yet formally recorded in one release matrix. | Wrong branch could be deployed or milestone work lost. | Create release baseline matrix and tags before implementation resumes. |
| TD-002 | Docs | Critical | Docs repo has uncommitted Phase 5E documentation. | Valuable architecture history could be overwritten. | Commit/preserve docs work before cleanup. |
| TD-003 | Frontend | High | Debug logging remains in auth/report/user flows. | Production logs may expose sensitive context or become noisy. | Gate logs behind debug flag and remove sensitive prints. |
| TD-004 | Backend | High | Rate limiting/throttling not observed. | Auth/upload/public endpoints vulnerable to abuse. | Add throttling for auth, OTP, uploads and public endpoints. |
| TD-005 | Backend | High | Uploads served from local `/uploads`. | Scaling, security and access-control risks. | Add storage policy, malware scanning, signed/private access where needed. |
| TD-006 | Backend | High | Provider auth has had repeated regressions. | Providers blocked from operational workflows. | Keep provider login/reset/hash tests mandatory. |
| TD-007 | Frontend | High | Mobile overflow regressions have occurred on admin/provider screens. | Poor Android/mobile UX. | Maintain mobile smoke test matrix. |
| TD-008 | Website | High | Contact form logs to console. | Lead capture appears functional but is not. | Integrate real contact endpoint/service. |
| TD-009 | Docs | Medium | Mojibake encoding artifacts in docs. | Professional polish issue. | Run docs-only encoding cleanup. |
| TD-010 | Backend | Medium | Future module placeholders exist in config/readiness. | Accidental activation/confusion. | Keep explicit metadata-only labels and activation guards. |
| TD-011 | Backend | Medium | Backup/restore evidence not verified in audit. | Recovery confidence incomplete. | Run and document restore drill. |
| TD-012 | Infrastructure | Medium | Redis usage not confirmed in code sample. | Architecture docs may imply unused dependency. | Mark Redis active/future-only clearly. |
| TD-013 | Frontend | Medium | Some placeholder/future states in monetization/provider approval/report details. | Enterprise UX feels unfinished if user-facing. | Replace with locked, roadmap or real data states. |
| TD-014 | Backend | Medium | Dashboard/report query scale needs ongoing index review. | Slow dashboards with large tenants. | Add query/index profiling before large deployments. |
| TD-015 | Website | Medium | SEO/accessibility/performance evidence missing. | Reduced discoverability and compliance. | Run Lighthouse, axe/manual checks and SEO review. |
| TD-016 | Security | Medium | Secret rotation/environment ownership not verified. | Operational security gap. | Document secret owners, rotation cadence and storage. |
| TD-017 | Backend | Low | Legacy `X-FixZone-Api` header remains. | Branding inconsistency/minor metadata leakage. | Review in future non-breaking branding/security pass. |
| TD-018 | Frontend | Low | `pubspec.yaml` description remains default Flutter text. | Professional polish issue. | Update metadata when safe. |
| TD-019 | Docs | Low | Architecture diagrams are not central in audit docs. | Harder stakeholder onboarding. | Add diagram pack. |
| TD-020 | QA | High | Production smoke evidence not centralized. | Regression detection depends on memory/manual notes. | Create smoke-test evidence log per release. |
| TD-021 | Release | Critical | Milestone work has high cross-system regression exposure if merged as one batch. | Auth, workflow, mobile UI or API compatibility may regress in production. | Use release-candidate branches and tranche-based integration. |
| TD-022 | Release | Critical | Exact production commit baselines are not yet verified in this audit. | Rollback target may be ambiguous. | Capture live backend/frontend/website commits before stabilization. |
| TD-023 | QA | High | Manual UAT coverage is not yet recorded as a release gate. | Automated tests may miss role-specific portal regressions. | Require citizen, provider, org admin, dispatch and super admin smoke tests. |
| TD-024 | Deployment | High | Deploy branches appear older than main/master/milestone refs. | Production deployment may accidentally miss important fixes or deploy stale code. | Review deployment branch strategy before release. |
| TD-025 | Database | High | Migration rollback posture must be verified before milestone deployment. | Additive changes may be safe, destructive changes could force restore. | Require migration review and staging migration before production. |

## Protected Debt

Some apparent debt is intentional and should not be “fixed” casually:

- Future service modules are metadata-only by design.
- Report model names remain unchanged for compatibility.
- FixZone repository/package names may remain internal compatibility names.
- Maintenance/FixZone remains the only active service.
