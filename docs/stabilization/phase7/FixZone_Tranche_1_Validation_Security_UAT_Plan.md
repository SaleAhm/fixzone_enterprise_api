# FixZone Tranche 1 Validation, Security, and UAT Plan

Date: 2026-07-31

Status: prepared locally; not committed, pushed, deployed, or applied to production.

## Scope

This tranche restores check-only release validation, records the upload storage policy, reviews core security and privacy boundaries, and prepares authenticated browser UAT. It does not authorize deployment or production migration execution.

## Upload Storage Policy

Runtime report evidence files under `uploads/report-evidence/` and provider completion evidence files under `uploads/report-completion/` are local runtime artifacts and must not be committed. Demo upload assets under `uploads/demo/` remain repository assets. Existing tracked legacy/sample completion files remain tracked until a separate cleanup is approved.

Production evidence must be stored on persistent mounted storage or an approved object-storage service. The repository must not be treated as evidence storage. Before deployment, confirm that the production `uploads/` mount is present, writable by the API process, backed up, and excluded from source-control packaging.

## Static Security Validation

The backend `npm run test:rules:static` command is restored by adding `test/security-rules.static-test.cjs`. The check is deterministic and inspects static controls for:

- global DTO validation;
- CORS configuration;
- exception sanitization;
- global throttling and endpoint rate-limit decorators;
- bcrypt password handling;
- JWT expiry enforcement;
- role guards on protected controllers;
- report/provider/organization ownership checks;
- invitation recipient, expiry, and pending-state checks;
- upload MIME, signature, size, and path controls;
- upload static-serving headers;
- ignored environment files and runtime evidence directories.

## Security Findings

Critical: none proven in this tranche.

High:

- `JWT_ACCESS_SECRET` has a development fallback in `AuthModule`, `AuthService`, and `JwtStrategy`. Production must provide a strong secret and should later fail startup if the secret is absent in production.
- `/uploads` serves evidence URLs publicly to anyone with the URL. Current controls reduce executable-content risk, but protected evidence delivery or signed URLs remain the recommended production target.
- Dependency audit reports high/critical advisories in transitive packages. The strongest production concern is runtime framework/transitive exposure around Nest/platform dependencies; dev-tool-only advisories should still be tracked but are lower practical risk.

Medium:

- Error payloads mix plain Nest strings and structured domain objects. UAT can proceed, but a shared lifecycle error-code model should be added before broad production scale.
- Assignment collision protection is primarily service-level state validation. Consider a transactional compare-and-update or explicit locking model for high-concurrency dispatch.
- Static upload serving depends on persistent local storage; production backup/restore and retention policy must be operationally verified.
- Check-only ESLint now completes but fails because of existing prettier/type-safety debt. This is not newly introduced by Tranche 1, but it remains a push-readiness note unless the team accepts build/test/static-security gates as the immediate standard.

Low:

- Backend lint script uses `--fix`; release validation should continue to use direct check-only ESLint when no edit is intended.
- Some tracked legacy upload files exist under `uploads/report-completion/`; they should be reviewed in a separate cleanup task.

Informational:

- Passwords are bcrypt-hashed, JWTs expire, disabled/suspended users are blocked at login, and JWT validation reloads the current user from the database.
- Provider assignment, invitation, and organization assignment paths have automated unit/e2e coverage and static guard checks.
- A frontend file named `firebase-admin-credentials.cjs` is tracked but the local pattern scan found environment-variable references rather than embedded private-key material. Keep it on the release confirmation checklist.

## Migration Review

Unpushed migration under current review:

- `prisma/migrations/20260723110000_provider_invitation_org_assignment/migration.sql`

The migration is additive:

- adds nullable report organization-assignment fields;
- adds `Report_assignedOrganizationId_idx`;
- adds `Report.assignedOrganizationId -> Organization.id` with `ON DELETE SET NULL`;
- adds invitation indexes for organization/status and email/phone lookup.

Production prerequisites:

- verified production backup and restore evidence;
- current production migration status captured;
- confirmation that only expected pending migrations are present;
- migration run during an approved window using `npx prisma migrate deploy`;
- post-migration schema verification and smoke tests.

Rollback limitation: once organization assignment data is written, rolling back by dropping fields would lose data. Prefer application rollback first; database rollback requires explicit data preservation planning.

## Authenticated Browser UAT Plan

Capture desktop, tablet, and mobile evidence. For every failure, record screenshot, request method/path/status, sanitized console/network notes, account role, and expected versus actual result.

### Citizen Flow

1. Register or log in as a citizen. Expected: dashboard loads only citizen data.
2. Submit a report with category, description, location, and evidence. Expected: report created, evidence preview/url present, status pending.
3. Submit or prepare a likely duplicate. Expected: duplicate warning appears for likely self-duplicate.
4. Choose cancel. Expected: no report is created.
5. Repeat and choose proceed. Expected: report creates successfully.
6. Open report details and timeline. Expected: creation and later assignment events appear newest/chronological as designed.
7. After admin assignment, verify assigned provider or organization is visible.
8. After provider completion, verify completion note/evidence is visible.
9. Confirm completion with rating/feedback. Expected: report moves to closed/final state.
10. Repeat a separate report with citizen rejection. Expected: report returns to actionable assigned/review state and activity records the reason.

### Admin Flow

1. Log in as administrator. Expected: admin routes load; non-admin routes remain restricted.
2. Confirm newest-first report queue.
3. Inspect duplicate visibility. Expected: current implementation shows self-duplicate frontend warning only; admin duplicate flag is absent unless later added.
4. Review provider readiness and organization readiness.
5. Assign a pending report directly to a provider. Expected: status assigned, assignment controls change/lock.
6. Assign a pending report to an organization. Expected: assigned organization is visible and notifications/activity are created.
7. Attempt reassignment where allowed. Expected: previous assignment cancelled/audited and new provider assigned.
8. Cancel an assignment. Expected: report returns to pending dispatch queue.
9. Expire overdue assignments. Expected: overdue reports return to queue only within admin scope.
10. Create, cancel, and resend invitations. Expected: lifecycle state and recipient notifications are correct.
11. Review report timeline, notifications, audit/history, completion, citizen rejection, and citizen confirmation states.

### Provider Flow

1. Log in or accept a provider invitation. Expected: intended recipient only can accept.
2. Complete/read provider profile readiness fields. Expected: service categories and coverage are visible.
3. View assigned job. Expected: only assigned jobs are visible.
4. Accept assignment. Expected: status moves to in progress.
5. Reject a separate assignment. Expected: assignment returns to dispatch queue and provider loses action controls.
6. Submit completion note, evidence, and location metadata if enabled. Expected: status moves to completed by provider.
7. Attempt duplicate/stale completion. Expected: rejected with a safe error.
8. Test expired/cancelled invitation. Expected: reuse is rejected.

### Organization Flow

1. Log in as organization administrator/member. Expected: organization identity is correct.
2. Verify organization isolation by attempting another organization's resources. Expected: 403/404 safe denial.
3. Review organization readiness, member list, provider list, and reports.
4. Invite an existing provider and accept as that provider. Expected: membership is upserted without creating a duplicate user.
5. View organization-assigned report. Expected: state is visible and scoped.
6. Dispatch or handle assignment according to the implemented organization design.

### Security Negative Tests

- Citizen attempts another citizen's report by guessed ID: expect denial.
- Provider attempts unassigned report: expect denial.
- Organization user attempts cross-organization resources: expect denial.
- Non-admin calls admin endpoint/action: expect denial.
- Cancelled/expired invitation is reused: expect conflict/denial.
- Accepted invitation is reused by another user: expect denial.
- Unauthorized evidence URL/download is attempted: document current `/uploads` behavior; protected delivery is a known future hardening item.
- Stale assignment action repeated: expect conflict/forbidden.
- Duplicate completion confirmation/rejection submitted: expect denial.

## Release and Rollback Preparation

Recommended order after explicit authorization:

1. Commit frontend and backend stabilization changes.
2. Push frontend and backend branches.
3. Verify production backup and restore evidence.
4. Confirm production env values, especially `JWT_ACCESS_SECRET`, CORS origins, database URL, and uploads mount.
5. Run read-only production preflight checks.
6. Deploy backend with migration using approved process.
7. Run backend health and smoke tests.
8. Deploy Flutter web.
9. Run authenticated smoke tests and monitor for at least 60 minutes.

Immediate rollback triggers: migration failure, backend startup failure, repeated 5xx, authentication regression, cross-tenant access, evidence upload failure, assignment/completion regression, or abnormal database locks/connections.

## Tranche 2 Local Hardening Update

This local tranche adds production-safe JWT configuration and protected report evidence delivery without migrations, deployments, production data access, or infrastructure changes.

### JWT Secret Policy

`JWT_ACCESS_SECRET` is now resolved through a single backend helper used by `AuthModule`, `AuthService`, and `JwtStrategy`.

- `development` and `test` may use the explicit local-only fallback `fixzone_local_development_jwt_secret`.
- `staging` and `production` must provide `JWT_ACCESS_SECRET`.
- Missing, empty, whitespace-only, known fallback, or obvious placeholder values are rejected during application configuration/startup.
- Error messages name the required variable but do not print the configured secret value.

Production prerequisite: configure a strong non-placeholder `JWT_ACCESS_SECRET` before deploying this tranche. No production secret was read, rotated, generated, or modified during local work.

### Protected Evidence Architecture

Private report evidence remains stored under the existing persistent upload roots:

- `uploads/report-evidence/<reportId>/<fileName>`
- `uploads/report-completion/<reportId>/<fileName>`

The database continues to preserve existing path/url fields for compatibility, but API responses now prefer authenticated routes for private report evidence:

- `GET /api/report/:reportId/evidence/:fileName`
- `GET /api/report/:reportId/completion-evidence/:fileName`

The endpoints require JWT authentication, validate the requested report/file pairing, restrict file resolution to approved upload roots, stream the file, and set `Content-Type`, `Content-Disposition`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.

### Evidence Authorization Matrix

Allowed:

- Citizen owner of the report.
- Currently or historically assigned provider when the provider is active and authorized for the report organization.
- Active organization admin or dispatch officer in the report organization.
- Super administrator.

Denied:

- Unauthenticated requests.
- Cross-citizen access.
- Unassigned provider access.
- Cross-organization admin/dispatch access.
- Invalid report/evidence pairings.
- Path traversal and missing-file requests.

### Static Upload Decision

`/uploads/demo` remains public static content with hardened static headers for demo/sample assets. Private `report-evidence` and `report-completion` roots are no longer served from the root `/uploads` static route in backend startup code. Deployment must preserve the upload volume and avoid exposing private runtime evidence through a separate web server or reverse proxy alias.

### Frontend Evidence Access

Flutter report detail surfaces now normalize private report evidence to the protected API routes and render them through authenticated byte fetches using the normal bearer token header. Tokens are not placed in query strings. Demo assets can still render from `/uploads/demo`.

### Dependency Advisory Triage

Controlled non-force dependency remediation was applied only to compatible package families:

- Nest runtime/testing packages moved from `11.1.17` to `11.1.28`.
- `@nestjs/config` moved from `4.0.3` to `4.0.4`.
- Backend `firebase-admin` moved from `13.9.0` to `13.10.0`.
- Frontend Node tooling `firebase-admin` moved from `13.7.0` to `13.10.0`.
- Frontend Node tooling `firebase` moved from `12.15.0` to `12.17.0`.

Remaining critical/high advisories are documented for a separate dependency tranche where upstream major upgrades or package overrides can be reviewed independently. Do not use `npm audit fix --force` without a separate compatibility review.

### UAT Impact

Authenticated browser UAT should verify evidence rendering through the API, not direct private `/uploads` URLs. Negative tests should confirm guessed private upload URLs do not succeed without authorization while demo assets remain unaffected.
