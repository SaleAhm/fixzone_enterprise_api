# Production Readiness Tranche: Operational Governance, Evidence, Location, Lifecycle

Date: 2026-08-04

## Executive Result

Result: BLOCKED for full production readiness.

This tranche reached a coherent verified boundary, but it did not complete every requested production capability. Multi-image evidence, hybrid location capture fields, completion-evidence enforcement, provider metric messaging from the previous tranche, entity final-Super-Admin protection, and stronger demo-purge production safeguards were implemented or reinforced. The larger completion-governance policy model, pending-email-change workflow, full entity lifecycle management, Paystack provider foundation, and full cross-role evidence galleries remain blockers.

No production deployment, push, merge, production database reset, live purge, or live Paystack action was performed.

## Root Causes

- Evidence upload APIs already had protected upload endpoints, but report storage still exposed only legacy single-image report fields. The `EvidenceRecord` table was present and was the correct place to append ordered image records instead of adding a duplicate evidence model.
- Completion submission allowed status advancement without verifying persisted provider evidence. This let workflow tests and UI behavior treat completion proof as optional.
- Location capture had coordinate support and location-source metadata, but no durable human-readable location fields for name, address, or landmark.
- Responsibility routing already had high-confidence eligibility diagnostics and organization review states, but the UAT issue spans policy and UX: Super Admin override and organization-scoped review are still distinct workflows and need clearer UI separation.
- Provider analytics now explain unavailable response-time metrics, but the system still needs a separate durable provider acceptance timestamp if acceptance and work-start must be measured independently.
- Email editing is schema-incomplete. There is no durable pending-email-change entity or verified promotion flow.
- Entity lifecycle is incomplete beyond final active Super Admin protections and existing status fields.
- Demo purge had guarded preview and execute paths, but production mode needed a backend hard stop and backup-reference validation where backup metadata exists.
- Paystack remains manual-payment readiness only. No live keys were configured.

## Architecture Decisions

- Reused `EvidenceRecord` for multi-image report and completion evidence.
- Preserved legacy `Report.evidenceImagePath/evidenceImageUrl` and `Report.completionImagePath/completionImageUrl` for backward compatibility and existing clients.
- Appended new evidence records with `metadata.kind`, `metadata.order`, `metadata.classification`, and `metadata.imagePath`.
- Kept tenant and role checks inside existing report access and evidence-open flows.
- Added location text fields directly to `Report` because they are core report attributes and need search/display compatibility with existing report queries.
- Kept Paystack inactive. The correct next step is a provider abstraction and transaction/webhook schema before any live configuration.

## Schema Changes

`Report` now has:

- `locationName String?`
- `locationAddress String?`
- `locationLandmark String?`

`EvidenceRecord.uploadedById` is now nullable with `onDelete: SetNull` so historical evidence metadata does not block safe deletion/deactivation test cleanup or lifecycle assessment paths.

## Migrations

- `20260804130000_report_hybrid_location_fields`
  - Adds `locationName`, `locationAddress`, and `locationLandmark` to `Report`.
- `20260804133000_nullable_evidence_uploader`
  - Makes `EvidenceRecord.uploadedById` nullable.
  - Recreates the uploader foreign key with `ON DELETE SET NULL`.

Local migration status: `npx prisma migrate status` reported the local `fixzone_enterprise` database schema is up to date.

## Multi-Image Evidence

Implemented:

- Citizen report evidence upload now appends up to 5 `EvidenceRecord` rows.
- Provider completion evidence upload now appends up to 5 `EvidenceRecord` rows.
- Upload DTOs accept an optional `order`.
- Completion upload DTO accepts `classification` values: `before`, `during`, `after`, `completion`.
- Completion status advancement now requires either a submitted completion image in the DTO or an existing persisted completion evidence record.
- Existing legacy image fields are retained and populated for compatibility.
- Enterprise report detail evidence items now include records from `EvidenceRecord`, with legacy fallback de-duplicated.
- Frontend citizen submission supports camera/gallery selection, preview thumbnails, removal, and up to 5 images.
- Frontend provider completion supports camera/gallery selection, preview thumbnails, removal, and up to 5 images.

Remaining:

- Full cross-role report detail galleries and full-screen evidence preview were not completed in this tranche.
- Evidence deletion audit/activity events were not added.
- Reorder UI was not implemented; order is preserved by selection/upload order.

## Hybrid Location

Implemented:

- Citizen report creation accepts typed location name, optional address, and optional landmark.
- Frontend report submission exposes fields for location name, address, and landmark while preserving GPS/manual coordinates.
- Backend derives location source as `DEVICE_GPS`, `TYPED_LOCATION`, `COMBINED`, or `UNKNOWN`.
- Firestore fallback stores the new human-readable location fields.

Remaining:

- Search across `locationName`, `locationAddress`, and `locationLandmark` still needs full backend query coverage.
- Existing report detail screens need a complete pass to consistently show human-readable location first and coordinates second.
- No reverse-geocoding provider was added.

## Responsibility Routing

Implemented or verified:

- Existing responsibility diagnostics remain intact and include eligibility reasons, confidence, provider capability source, organization coverage, and jurisdiction comparisons.
- Previous routing work still distinguishes organization review from override ownership transfer.
- Frontend navigation now hides the organization-scoped Responsibility Review workspace from Super Admin users and keeps it visible for Organization Admin/Dispatch Officer users with organization context.

Remaining:

- A dedicated Super Admin Platform Routing/Oversight workspace remains a follow-up.
- Normal request-review UX needs pre-submit blocking reasons when backend rules consider an organization ineligible.
- No new dispatch lock or candidate ranking UI was completed in this tranche beyond existing backend behavior.

## Completion Governance

Implemented:

- Provider completion now requires at least one completion evidence image unless a future governed exemption is added.
- Citizen review/rating behavior is preserved.
- Workflow e2e tests were updated to use the real completion-evidence upload endpoint before provider completion.

Remaining blocker:

- The requested configurable policy model was not implemented. Missing items include organization verification authority, review windows, dispute/rework states, policy enum/storage, closure-policy audit fields, and cross-role policy messaging.

## Provider Metrics

Implemented in previous/current boundary:

- Provider response-time analytics use structured unavailable reasons.
- Provider dashboard/profile messaging distinguishes insufficient data from unavailable metrics.
- Provider completion counts now reflect completed/closed report states in the focused frontend service tests.

Remaining:

- A durable separate provider-acceptance timestamp/event was not added.
- Metric scope still needs clearer UI labeling across platform-wide, organization membership, current organization, and assignment organization contexts.
- Provider profile relationship display remains a UAT follow-up.

## Email-Change Workflow

Status: not implemented in this boundary.

Production blocker remains:

- Need pending-email-change schema, hashed one-time token/OTP, expiry, resend rate limit, cancellation, duplicate email checks, recent-auth/password confirmation, audit events, email delivery integration, session refresh/invalidation, masking, and final active Super Admin lockout protection.

## Entity Lifecycle

Implemented in previous/current boundary:

- Final active Super Admin protection exists for unsafe account lifecycle actions.
- `EvidenceRecord.uploadedById` can now survive user deletion as nullable historical metadata.

Remaining:

- Full archive/suspend/restore/delete-eligibility flows for organizations, providers, and users were not implemented.
- Assignability filtering for archived entities, deletion eligibility reports, anonymization policy, and restore conflict validation remain blockers.

## Demo Purge Safeguards

Implemented:

- Backend determines system mode from `SECUREZONE_SYSTEM_MODE`, `FIXZONE_SYSTEM_MODE`, `PLATFORM_MODE`, or `NODE_ENV`.
- Demo purge execute rejects `PRODUCTION` mode with 403.
- Preview includes system mode.
- Execute still requires guarded inputs from the previous tranche.
- Backup reference is validated against existing `platformBackup` records when backup metadata exists.

Remaining:

- Dry-run mode, idempotency/replay protection, file reconciliation summary, and separate audited unlock workflow remain follow-ups.
- Prior demo purge e2e executed only against generated local fixtures. No live or production purge was performed in this tranche.

## Paystack Status

Status: not implemented in this boundary.

Current state remains manual-invoice/payment-readiness. No Paystack live keys, sandbox keys, webhook secret, or production payment action were configured. Required next work is payment provider abstraction, Paystack adapter, transaction/reference schema, webhook persistence, signature verification, duplicate protection, amount/currency integrity checks, reconciliation, failure states, and tests.

## Tests And Commands

Backend:

- `npx prisma format`: passed.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npx prisma migrate deploy`: applied local migrations.
- `npx prisma migrate status`: database schema up to date.
- `npm run build`: passed.
- `npm test -- --runInBand src/report/report.service.spec.ts src/users/users.service.spec.ts`: passed, 36/36.
- `npm test -- --runInBand test/report-workflow.e2e-spec.ts`: passed, 30/30.
- `npm test -- --runInBand`: passed, 20 suites and 162 tests.
- `npx eslint ...touched production files...`: failed, 360 errors and 9 warnings, mostly existing `@typescript-eslint/no-unsafe-*` patterns in large touched services.
- `npx eslint ...touched files including tests...`: failed, 608 errors and 153 warnings, mostly existing `@typescript-eslint/no-unsafe-*` patterns in specs/services. The Prisma schema was ignored by ESLint config.

Frontend:

- `dart format ...touched files...`: passed, 7 files, 0 changed.
- `flutter analyze`: passed.
- `flutter test test\location_metadata_test.dart test\provider_data_service_test.dart test\platform_tools_screen_test.dart`: passed, 8/8.
- `flutter test`: passed, 110/110.
- `flutter build web`: passed.

Not run:

- Browser/Playwright responsive UAT.

## Remaining Blockers

- Configurable completion-governance policy and organization verification.
- Pending-email-change workflow.
- Full organization/provider/user lifecycle management.
- Paystack foundation.
- Complete cross-role evidence galleries and full-image preview.
- Search by new human-readable location fields.
- Super Admin responsibility-routing workspace UX.
- Touched-file ESLint is not clean.
- Full browser UAT has not been rerun.

## UAT Checklist

1. Citizen submits a report with typed location name, GPS coordinates, address/landmark, and multiple evidence images.
2. Verify report detail shows human-readable location and preserves coordinates.
3. Platform triage evaluates routing candidates and displays eligibility reasons.
4. Eligible organization receives a responsibility review invitation.
5. Organization accepts and report becomes dispatchable.
6. Organization assigns provider.
7. Provider accepts or begins work according to the current workflow.
8. Provider uploads multiple completion images.
9. Provider submits completion and sees accurate awaiting-review messaging.
10. Citizen reviews evidence, rates, confirms, or requests rework.
11. Organization verification is tested once the policy model is implemented.
12. Final closure follows the configured policy once implemented.
13. Citizen, provider, organization, and Super Admin see consistent timeline/evidence.
14. Provider analytics show count, sample size, scope, and unavailable reason.
15. User requests email change and verifies it once implemented.
16. Entity archive/restore/delete eligibility is tested once implemented.
17. Demo purge preview works without execution.
18. Production mode blocks demo purge with 403.
19. Paystack remains visibly not configured unless sandbox/test configuration is intentionally added.

## Safety Confirmation

- No push.
- No merge.
- No deployment.
- No production database reset.
- No live purge.
- No live demo purge.
- No real Paystack key configuration.
- No live payment action.
- Local migrations were applied only to the local `fixzone_enterprise` database.
