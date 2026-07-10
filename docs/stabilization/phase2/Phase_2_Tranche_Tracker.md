# Phase 2 Tranche Tracker

Date: 2026-07-09

## Purpose

This tracker provides operational visibility for Phase 2 execution. It is documentation-only and does not authorize implementation, code changes, package installation, migrations, pushes, merges, deployments, service restarts, or production database activity.

## Phase 2 Objective Summary

Phase 2 expands SecureZone toward a controlled enterprise platform while preserving the existing Maintenance/FixZone production foundation. Phase 2 must keep `Report` workflows stable, keep Maintenance as the only active production module unless separately approved, and move future modules through governed metadata, entitlement, access, and adapter layers before any workflow activation.

## Tranche Definitions

| Tranche | Name | Objective | Primary Repositories |
| --- | --- | --- | --- |
| T1 | Phase 1 Merge and Governance Baseline | Establish reviewed Phase 1 baseline and governance tags | Backend, Frontend, Website |
| T2 | Evidence Delivery and Upload Lifecycle | Protect evidence access and prepare upload lifecycle controls | Backend, Frontend |
| T3 | Rate-Limit Observability and Operational Tuning | Make throttling observable and tunable | Backend, Frontend if surfaced |
| T4 | Module Entitlements and Access Enforcement Foundation | Add governed module entitlement readiness without activating future modules | Backend, Frontend |
| T5 | Enterprise Service Framework Expansion | Expand metadata, adapters, analytics, and capability foundations safely | Backend, Frontend |
| T6 | Dependency and Technical Debt Cleanup | Resolve known warnings and controlled dependency metadata issues | Backend, Website |

## Dependencies Between Tranches

| Tranche | Depends On | Dependency Reason |
| --- | --- | --- |
| T1 | None | Establishes Phase 2 baseline |
| T2 | T1 | Evidence work must start from reviewed Phase 1 upload hardening |
| T3 | T1 | Observability must use the approved rate-limit baseline |
| T4 | T1 | Entitlement work requires approved governance baseline |
| T5 | T4 recommended | Framework expansion should align with entitlement/access rules |
| T6 | T1 | Cleanup must run from stable baseline and avoid mixing with feature tranches |

## Entry Criteria by Tranche

| Tranche | Entry Criteria |
| --- | --- |
| T1 | Branch owners review Phase 1 commits; merge order approved; untracked Phase 1 docs disposition decided |
| T2 | Evidence design approved; compatibility plan for existing `/uploads/...` references approved; access matrix drafted |
| T3 | Rate-limit telemetry requirements approved; route groups and expected thresholds documented |
| T4 | Module entitlement model approved; Maintenance non-breaking behavior documented; tenant rules approved |
| T5 | T4 policy assumptions settled; service framework extension design approved; adapter compatibility plan drafted |
| T6 | Dependency or warning cleanup scope approved; no active runtime tranche conflicts |

## Exit Criteria by Tranche

| Tranche | Exit Criteria |
| --- | --- |
| T1 | Phase 2 baseline branch approved; required docs committed or archived; baseline validation passed |
| T2 | Existing evidence remains accessible; protected access validated; upload lifecycle behavior documented |
| T3 | Operators can distinguish expected throttling from abuse; emergency tuning notes documented |
| T4 | Future modules remain locked or metadata-only; Maintenance access remains compatible; entitlement tests pass |
| T5 | Framework changes are read-only or non-blocking; `Report` compatibility tests pass |
| T6 | Cleanup validated independently; no behavior change introduced unintentionally |

## Deliverables by Tranche

| Tranche | Required Deliverables |
| --- | --- |
| T1 | Branch baseline report; Phase 1 docs disposition note; local tag recommendation; validation report |
| T2 | Evidence delivery design; upload lifecycle design; access matrix; rollback note; validation report |
| T3 | Rate-limit observability design; route profile review; tuning guide; validation report |
| T4 | Module entitlement design; tenant isolation review; RBAC/access matrix; validation report |
| T5 | Service framework expansion design; adapter compatibility report; analytics/provider capability review |
| T6 | Dependency cleanup note; warning resolution report; regression validation report |

## Validation Requirements

Backend baseline:

- `npx prisma validate`
- `npx prisma generate`
- `npm run build`
- `npm test -- --runInBand`
- `npm run test:e2e -- --runInBand`

Frontend baseline:

- `flutter analyze`
- `flutter test`
- `flutter build web --release`

Website baseline:

- `npm run build`
- `npm run typecheck`
- `npm run lint`

## Regression Requirements

| Tranche | Required Regression Focus |
| --- | --- |
| T1 | Full backend, frontend, website baseline validation after baseline creation |
| T2 | Evidence upload, evidence read/access, citizen report flow, provider completion evidence, old evidence links |
| T3 | Auth, upload, onboarding, notifications, admin tools, legitimate retry flows, expected `429` flows |
| T4 | Module access states, tenant isolation, role gates, organization module behavior |
| T5 | Existing `Report` lifecycle, service metadata endpoints, provider capability metadata, admin navigation |
| T6 | Full impacted repo validation and smoke tests for unchanged runtime behavior |

## Risk Tracking

| Risk ID | Risk | Level | Owner | Mitigation | Status |
| --- | --- | --- | --- | --- | --- |
| P2-R-001 | Breaking Maintenance/FixZone workflows | High | TBD | Compatibility tests and tranche gates | Open |
| P2-R-002 | Evidence access regression | High | TBD | Preserve legacy path and add role matrix tests | Open |
| P2-R-003 | Tenant boundary regression | High | TBD | Cross-tenant negative tests | Open |
| P2-R-004 | Rate-limit false positives | Medium | TBD | Observability and tuning guide | Open |
| P2-R-005 | Upload false rejections | Medium | TBD | Client compatibility tests and staged rollout | Open |
| P2-R-006 | Future module accidental activation | High | TBD | Keep future modules locked/metadata-only | Open |
| P2-R-007 | Migration rollback complexity | Medium | TBD | Default no migrations; approval required | Open |
| P2-R-008 | Dependency cleanup mixed with runtime behavior | Medium | TBD | Keep cleanup in separate tranche | Open |

## Progress Tracking

| Tranche | Status | Start Date | Completion Date | Validation Status | Notes |
| --- | --- | --- | --- | --- | --- |
| T1 | Not started | TBD | TBD | Pending | Phase 1 baseline review required |
| T2 | Not started | TBD | TBD | Pending | Evidence delivery approval required |
| T3 | Not started | TBD | TBD | Pending | Observability requirements required |
| T4 | Not started | TBD | TBD | Pending | Entitlement design required |
| T5 | Not started | TBD | TBD | Pending | Depends on access/entitlement assumptions |
| T6 | Not started | TBD | TBD | Pending | Keep separate from runtime feature work |

## Detailed Tranche Tracking

| Tranche | Design Approved | Implementation Approved | Tests Added | Validation Passed | Rollback Ready | Docs Complete |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | No | No | N/A | No | No | No |
| T2 | No | No | No | No | No | No |
| T3 | No | No | No | No | No | No |
| T4 | No | No | No | No | No | No |
| T5 | No | No | No | No | No | No |
| T6 | No | No | No | No | No | No |

## Rollback Checkpoints

| Tranche | Rollback Checkpoint |
| --- | --- |
| T1 | Confirm baseline tags and Phase 1 revert points before implementation starts |
| T2 | Confirm legacy evidence delivery path remains available before protected delivery enforcement |
| T3 | Confirm emergency rate-limit tuning or disablement path before threshold changes |
| T4 | Confirm future modules can return to locked/metadata-only state |
| T5 | Confirm framework metadata changes can be reverted without changing `Report` behavior |
| T6 | Confirm dependency or warning cleanup can be reverted independently |

## Documentation Checkpoints

Required before each tranche starts:

- Tranche approval note.
- Design note.
- Test plan.
- Migration assessment.
- Rollback note.
- Validation plan.

Required before each tranche closes:

- Implementation summary, if implementation occurred.
- Validation report.
- Regression result summary.
- Remaining risk update.
- Rollback readiness update.
- Merge readiness checklist.

## Final Phase 2 Completion Checklist

- [ ] All approved tranches completed or explicitly deferred.
- [ ] Maintenance/FixZone workflows validated and compatible.
- [ ] No future module activated in production without separate approval.
- [ ] Backend validation passed.
- [ ] Frontend validation passed for impacted frontend work.
- [ ] Website validation passed for impacted website work.
- [ ] Migration report completed, if migrations occurred.
- [ ] API compatibility report updated if APIs changed.
- [ ] Data model governance updated if schema changed.
- [ ] Security review updated.
- [ ] Operational monitoring checklist completed.
- [ ] Rollback notes verified for runtime changes.
- [ ] Remaining risks accepted or assigned.
- [ ] Phase 2 completion report prepared.
- [ ] Phase 3 authorization review prepared if further expansion is proposed.

## Implementation Hold

This tracker does not start implementation. Every tranche remains `Not started` until explicit branch-owner and release-owner approval is recorded.
