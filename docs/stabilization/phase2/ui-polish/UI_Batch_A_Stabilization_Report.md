# UI Batch A Stabilization Report

SecureZone / FixZone Phase 2 UI Stabilization  
Batch: A  
Report date: 2026-07-10

## 1. Starting repository baselines

| Repository | Branch | Starting HEAD | Starting state |
| --- | --- | --- | --- |
| Backend API | `phase-4-platform-expansion` | `2b9fe0cb0b2a6ecdc90e9b8b641af54fae4353f6` | clean, ahead 18 |
| Flutter app | `phase-4-platform-expansion` | `fddb16c1009496b76a42c34577ee7200ba543ae1` | clean, ahead 1 |
| Website | `phase-1-website-stabilization` | `e0c40fd0a9903ce42fc5a3e3b756d7d5a113980a` | clean, no upstream |

Production baselines remain protected and were not modified.

## 2. Observations addressed

| Observation | Result |
| --- | --- |
| OBS-001 Provider auth reliability | Verified through backend auth e2e; no backend defect reproduced. |
| OBS-002 Provider ID login support | Verified backend supports provider-ID login; frontend payload now omits empty email instead of relying on backend empty-string normalization. |
| OBS-005 Provider public ID display | Verified admin/provider surfaces prefer public `providerId`; card text constraints were tightened. |
| OBS-007 Evidence visibility | Improved frontend image URL normalization for relative path fields and `media.images`. |
| OBS-008 Provider analytics layout | KPI grid, KPI card text, activity rows, and legend made more responsive. |
| OBS-016 Admin provider cards mobile overflow | Provider cards tightened with wrapping/ellipsis-safe controls. |
| OBS-021 Platform Tools rendering | Existing selected-panel implementation verified by tests; panel/card text overflow guards tightened. |
| OBS-022 Platform Tools mobile overflow | Tool card ratio/padding and info-line layout improved for narrow widths. |
| OBS-027 Long labels/IDs | Added additional ellipsis/wrap constraints on provider/admin/tool surfaces. |

## 3. Root causes

1. Provider-ID-only login in Flutter allowed empty email in the UI but still serialized `"email": ""` to the backend. Backend normalization already handled this safely, but the frontend contract was ambiguous.
2. Provider analytics KPI cards used a constrained grid with dynamic text in fixed-height cells. Small mobile widths and text scaling could overflow vertically.
3. Recent Activity legend/status rows used single-row layouts that could overflow at narrow widths.
4. Platform Tools cards and info rows had fixed row assumptions around variable subtitles and long backend values.
5. Evidence image normalization only covered selected URL fields and missed path-style fields such as `completionImagePath`, `evidenceImagePath`, `imagePath`, and `media.images`.

## 4. Backend files changed

No backend runtime files changed.

Documentation added:

- `docs/stabilization/phase2/ui-polish/UI_Batch_A_Stabilization_Report.md`

## 5. Flutter files changed

- `lib/core/services/api_service.dart`
- `lib/features/provider/presentation/screens/provider_login_screen.dart`
- `lib/features/provider/presentation/screens/provider_analytics_screen.dart`
- `lib/features/admin/presentation/screens/admin_platform_tools_screen.dart`
- `lib/features/admin/presentation/screens/admin_providers_screen.dart`

## 6. Defects fixed

- Provider login payload now supports provider-ID-only login explicitly by omitting empty email.
- Provider session storage now records the backend-returned provider email when available.
- Provider analytics KPI cards have more vertical room and compact text rules on narrow widths.
- Provider Recent Activity rows stack when too narrow and the legend wraps.
- Admin provider cards constrain long provider/billing/capability labels.
- Platform Tools cards have more forgiving ratios and reduced padding.
- Platform Tools info rows wrap/ellipsis long values instead of overflowing.
- Evidence URL normalization now handles relative path fields and `media.images`.

## 7. Items verified as already working

- Backend provider authentication tests already cover seeded provider login, provider-ID login, newly registered provider login, reset-password provider login, suspended provider rejection, and provider role access.
- Backend report workflow tests already cover assignment, provider acceptance, completion, citizen review notification, and rating workflow.
- Platform Tools selected-panel rendering is covered by existing Flutter widget tests.

## 8. Items not reproduced

- No backend provider-auth defect was reproduced in local e2e verification.
- No backend assignment-notification defect was reproduced in local report workflow e2e verification.
- No Platform Tools blank-panel runtime exception was reproduced by existing widget tests.

## 9. Items deferred

- Assignment timeout countdown and auto-unassign behavior.
- Full reassignment/SLA warning architecture.
- Duplicate report detection.
- GIS/responsibility routing expansion.
- Payment gateway.
- Public website live-data integration.
- Backup restore/download hardening.
- SMS, WhatsApp, Telegram, or production push notification channels.

## 10. Provider authentication result

Provider authentication was verified through `auth.e2e-spec.ts`.

Result: passed.  
Backend runtime change required: no.

The frontend login payload was clarified so provider-ID-only login no longer sends an empty email field.

## 11. Notification/job-assignment result

Assignment and notification behavior was verified through `report-workflow.e2e-spec.ts`.

Result: passed.  
Backend runtime change required: no.

The test run emitted a PostgreSQL client deprecation warning, but no assignment or notification failure.

## 12. Evidence visibility result

Evidence rendering was improved at the frontend API mapping layer. Authorized report detail calls that return relative evidence paths now normalize those paths to the API origin before `Image.network` receives them.

Authorization was not weakened. Upload validation was not changed.

## 13. Platform Tools result

Platform Tools retains the selected-tool rendering model:

- Demo Wizard
- System Health
- Cache Manager
- Backup & Restore
- Maintenance Mode
- Audit Utilities

Existing widget tests confirmed selected cards render panels without exceptions. Layout guards were tightened for mobile and variable text.

## 14. Responsive-width validation

| Width | Result |
| --- | --- |
| 320px | Provider analytics/cards adjusted for narrow text and taller KPI cells; Platform Tools info rows stack when needed. |
| 360px | Activity rows and legends wrap/stack safely. |
| 375px | Provider cards use ellipsis/wrap constraints. |
| 390px | Existing admin mobile navigation tests passed at 390px. |
| 430px | Same mobile layout rules apply. |
| 768px | Tablet grid ratios preserved with safer card heights. |
| Desktop | Sidebar/desktop behavior preserved; desktop grid remains multi-column. |

Validation evidence includes `flutter analyze`, `flutter test`, and `flutter build web --release`.

## 15. Test and build results

Backend targeted verification:

- `npm run test:e2e -- --runInBand auth.e2e-spec.ts` — passed, 21 tests.
- `npm run test:e2e -- --runInBand report-workflow.e2e-spec.ts` — passed, 17 tests, with a non-blocking pg deprecation warning.

Flutter validation:

- `flutter analyze` — passed, no issues.
- `flutter test` — passed, 25 tests.
- `flutter build web --release` — passed.

Backend full build/full suite were not run because no backend runtime files were modified.

## 16. API compatibility assessment

No backend API contract changed.

Frontend request compatibility improved by omitting empty login identifiers and normalizing existing image path fields. Existing absolute `http`, `https`, `data`, and `blob` image URLs remain supported.

## 17. Auth/RBAC assessment

No RBAC rules changed. Backend e2e tests confirmed provider role login and provider/admin route access behavior remain intact.

## 18. Tenant-isolation assessment

No tenant-scope backend code changed. Report workflow e2e continued to pass. Evidence URL normalization is display-only and does not bypass protected report-detail API authorization.

## 19. Database impact

No Prisma schema changes.  
No migrations.  
No database reset.  
No production database activity.

## 20. Rollback instructions

Flutter rollback:

```bash
git revert 59573f9
```

Documentation rollback:

```bash
git revert <backend-doc-commit>
```

No database rollback is required.

## 21. Remaining conditions

- Manual emulator/browser smoke testing should still be performed against a running local backend for provider login, assigned jobs, notifications, evidence, and Platform Tools panels.
- Full backend build/test/e2e should be run before any release candidate, even though Batch A did not change backend runtime code.
- The pg deprecation warning observed in report workflow e2e should be tracked as technical debt.

## 22. Recommended next batch

Batch B should focus on manual smoke findings and any remaining workflow-visible defects:

1. Evidence display across every report/detail/review screen with real uploaded files.
2. Assignment notification click-through and unread-count verification in the running app.
3. Citizen completion validation wording/status consistency.
4. Organization admin dispatch visibility and tenant-isolation spot checks.
5. Lower-priority mobile polish from the backlog.
