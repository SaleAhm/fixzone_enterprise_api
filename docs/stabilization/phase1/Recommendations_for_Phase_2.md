# Recommendations for Phase 2

Date: 2026-07-09

## Phase 2 Objective

After Phase 1 stabilization, Phase 2 should focus on controlled hardening, operational readiness and release-candidate preparation. Do not activate future modules yet.

## Recommended Priorities

1. Create RC branches from protected baselines.
2. Push local milestone branches and tags only after explicit approval.
3. Keep website lint/typecheck validation in the RC gate.
4. Add rate limiting observability, threshold review and emergency tuning guidance.
5. Continue upload lifecycle hardening with protected evidence delivery, malware scanning and image dimension validation.
6. Add manual smoke evidence log for every role.
7. Add performance/load test dataset.
8. Investigate pg deprecation warning.
9. Reduce debug logging.
10. Preserve and commit docs repo Phase 5E documentation.

## Do Not Do Yet

- Do not activate Healthcare, Legal, Agriculture, Education, ICT, Security or other future modules.
- Do not rename `Report`.
- Do not migrate existing report data.
- Do not deploy directly from development branches.
- Do not change production branches without release approval.

## Phase 2 Exit Criteria

- All backend, Flutter and website gates pass.
- Manual role/workflow/mobile smoke evidence recorded.
- Security hardening accepted.
- Tenant isolation matrix verified.
- RC branch strategy approved.
