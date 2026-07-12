# Citizen Completion Review and Provider Rating Remediation Report

Date: 2026-07-12

Scope: Controlled source-level remediation for the FixZone Maintenance citizen completion review, provider rating, and completion evidence preview flow.

## 1. Previous documented assumption

Earlier Phase 2 UI stabilization records described the intended Provider -> Citizen Review -> Closed workflow as verified. The latest live production observation corrected that assumption: the citizen could open the review page, but the page only exposed a Back action and did not render approval, rework, rating, or feedback controls.

This report is the correction/addendum for that finding. It does not rewrite prior historical evidence.

## 2. Live production observation

Production showed the following state after provider completion:

- report status displayed as `COMPLETED BY PROVIDER`;
- completion timestamp, provider note, and completion image area were visible;
- completion image sometimes displayed `Unable to load image`;
- no `Approve Completion`, `Request Rework`, rating, feedback, rejection reason, or visible citizen-driven close action was available.

## 3. Source-level root cause

The backend already exposed citizen completion review endpoints and persisted citizen rating/feedback on approval. The runtime blocker was in the Flutter citizen review screen:

- the API returned the enum value `COMPLETED_BY_PROVIDER`;
- the Flutter screen compared status directly against lowercase `completed_by_provider`;
- therefore the review controls were hidden and the fallback Back action rendered.

The evidence preview inconsistency also had a client-side normalization gap:

- top-level completion image fields were normalized to absolute API URLs;
- nested `completion.imageUrl` / `completion.imagePath` values returned by the review endpoint were not normalized consistently.

## 4. Implementation completed

Backend:

- made citizen completion approval rating required at DTO validation level;
- saved `citizenRating` directly from the validated DTO;
- kept existing split endpoint design:
  - `GET /api/report/citizen/:id/completion-review`
  - `POST /api/report/citizen/:id/confirm-completion`
  - `POST /api/report/citizen/:id/reject-completion`
- added e2e coverage for ownership, role guards, rating validation, duplicate review prevention, and rework reason validation.

Flutter:

- normalized completion review status values before UI branching;
- restored visible review controls for `COMPLETED_BY_PROVIDER`;
- changed the primary action label to `Approve Completion`;
- changed the secondary action label to `Request Rework`;
- disabled approval until a 1-5 star rating is selected;
- added accessible labels/tooltips to the star selector;
- read provider completion note/timestamp from nested completion payloads when needed;
- normalized nested completion evidence image URLs through the shared API URL logic;
- preserved professional image fallback without hiding review actions.

## 5. Canonical workflow after remediation

- Provider marks report as `COMPLETED_BY_PROVIDER`.
- Citizen opens completion review.
- Citizen may approve with required rating and optional feedback.
- Approval transitions the report to `CLOSED`, persists rating/feedback, generates notification/audit/timeline workflow events through existing services, and prevents duplicate approval because the report is no longer awaiting review.
- Citizen may request rework with a required reason.
- Rework uses the existing canonical state `ASSIGNED`, stores `completionRejectionReason`, and notifies provider and organization operators through existing infrastructure.

## 6. Evidence preview findings

No upload validation was weakened and no private evidence authorization rule was relaxed.

The safe compatibility fix is client-side URL normalization for nested completion evidence fields. New valid uploads should render through the shared API base URL. Missing legacy files may still display the fallback message, which is expected and non-blocking.

## 7. Prisma and migration status

No Prisma schema change was required.

Existing report fields were reused:

- `citizenRating`
- `citizenFeedback`
- `completionRejectionReason`
- `completionImageUrl`
- `completionImagePath`
- `completedByProviderAt`

No migration was created or applied.

## 8. Tests added

Backend e2e coverage in `test/report-workflow.e2e-spec.ts` now verifies:

- citizen can load their own completion review;
- rating is required;
- rating below 1 and above 5 are rejected;
- approval before provider completion is rejected;
- different citizen is rejected;
- different tenant is rejected;
- provider is rejected;
- organization admin is rejected;
- successful approval closes the report and saves rating/feedback;
- duplicate approval is rejected;
- rework requires a reason;
- rework stores the reason and returns to the existing rework state.

Flutter validation confirmed analyze/test/build compatibility for the UI changes.

## 9. Deployment sequence

When deployment is separately authorized:

1. Deploy backend API first.
2. Verify `POST /api/report/citizen/:id/confirm-completion` rejects missing/invalid rating and accepts valid citizen-owned approvals.
3. Deploy Flutter web.
4. Smoke test provider completion -> citizen review -> approve with rating -> closed.
5. Smoke test provider completion -> citizen review -> request rework.
6. Confirm completion evidence preview renders for new valid uploads and fails gracefully for missing legacy files.

## 10. Rollback considerations

Rollback can be performed by reverting the backend and Flutter remediation commits on the release branch before redeployment. No database rollback is required because no migration was introduced.

## 11. Residual limitations

- No new standalone provider-rating table was introduced; rating remains on the existing `Report` record.
- Approval/rework continue to use the existing split endpoint family rather than a new combined decision endpoint.
- Rework returns to the existing `ASSIGNED` state to avoid enum and migration risk.
- Missing legacy evidence files will still show a fallback instead of an image.
- Production deployment, Dokploy changes, migrations, pushes, and tag operations were not part of this remediation task.
