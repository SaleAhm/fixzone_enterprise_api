# FixZone Production Browser UAT Checklist Tranche 4

Use approved production test accounts only. Do not record credentials, tokens, private evidence, or personal data in screenshots or notes.

## Citizen

- Phone OTP request accepts a valid phone number.
- OTP screen masks the phone number.
- Six-digit OTP validation and invalid-code messaging are professional.
- Resend countdown behavior is clear.
- Citizen dashboard loads after login.
- Citizen creates a report with category, description, GPS location, and safe evidence.
- Tracking ID is visible.
- Report appears newest-first in citizen report list.
- Own evidence opens through `/api/report/:id/evidence/:fileName`.
- No raw private `/uploads/report-evidence/...` URL is used.
- Completion evidence opens through `/api/report/:id/completion-evidence/:fileName`.
- Citizen can confirm or reject provider completion where supported.

## Hunslow Organization Admin

- Hunslow International Ltd is active and shows Maintenance Services readiness.
- Hunslow admin can invite an existing provider.
- Hunslow admin can invite a new provider.
- Invitation list is newest-first and statuses are clear.
- Resend is available only for pending invitations.
- Cancel/revoke is available only where authorized.
- Expired/revoked invitations show truthful states.
- Accepted provider appears in Hunslow provider roster.
- Hunslow dispatch shows only eligible Hunslow providers.
- Hunslow organization assignment preserves tenant isolation.

## Provider

- Provider login succeeds with approved credentials.
- Invalid login displays safe, non-technical messaging.
- Pending invitations are visible.
- Provider can accept an organization invitation.
- Provider can decline a separate pending invitation.
- Newly assigned job appears immediately in Provider Jobs > New.
- New assignment remains after refresh.
- Provider can accept an assignment; job moves to In Progress.
- Provider can reject a separate assignment with reason.
- Timed-out assignment returns to dispatch.
- Provider can upload completion evidence.
- Completion evidence opens through protected API.
- Completed/Awaiting Confirmation state is consistent across dashboard, jobs, and details.

## Admin

- Admin login succeeds with approved super-admin account.
- Invalid login displays safe, non-technical messaging.
- Dispatch queue is sorted according to intended priority/newest rules.
- New report appears in Dispatch.
- Admin assigns provider; provider notification and Provider Jobs agree.
- Admin assigns organization where intended.
- Reassign and cancel states are clear and audited.
- Timelines show assignment, evidence, acceptance/rejection, completion, and citizen review events.
- Evidence opens only through protected API routes.
- Analytics labels distinguish lifetime, today, this month, assigned, completed by provider, and closed.
- Provider capability/readiness labels are understandable.
- Backup list labels metadata snapshots separately from VPS operational backups.
- Download and restore controls are permissioned and governance messaging is truthful.

## Negative Security

- Unauthenticated evidence request returns safe denial.
- Citizen cannot access another citizen's evidence.
- Provider cannot access an unrelated unassigned report's evidence.
- Cross-organization user cannot access Hunslow evidence.
- Invalid report/file pairing is denied.
- Path traversal attempt is denied.
- Direct private static `/uploads/report-evidence/...` and `/uploads/report-completion/...` URLs are denied.
- Non-admin cannot access Platform Tools backup endpoints.

## Responsive Viewports

Run the core paths at:

- 390x844
- 768x1024
- 1440x900

Check login/OTP, Provider Jobs, invitation screens, report details, evidence preview, dispatch controls, backup/restore controls, dialogs, snackbars, focus order, touch targets, no clipping, and no horizontal overflow.
