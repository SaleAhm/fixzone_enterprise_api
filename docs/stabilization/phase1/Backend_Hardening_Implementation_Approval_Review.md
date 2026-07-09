# Backend Hardening Implementation Approval Review

Date: 2026-07-09
Branch reviewed: `phase-4-platform-expansion`
Status: Approval review only; implementation not started.

## Recommendation

APPROVE WITH CONDITIONS

The proposed rate limiting and upload security hardening plans are directionally correct for this NestJS backend and should proceed after the conditions below are accepted:

- Start with conservative, observable limits and tune after staging/mobile validation.
- Implement rate limiting with environment-configurable values and a clear disable/rollback switch.
- Treat proxy/IP handling as a release blocker before enforcing IP-based limits.
- Keep upload hardening backward compatible with existing evidence URLs and paths.
- Do not require database migrations for the first implementation pass.
- Do not move from public `/uploads` to protected evidence delivery in the same change unless that is separately approved.

## 1. Rate Limiting Fit

`@nestjs/throttler` is the best fit for the first implementation pass.

Reasons:

- The backend is already a NestJS application using standard modules, guards, controllers, and decorators.
- The design needs global defaults plus route-specific policies, which maps cleanly to Nest guards/decorators.
- It keeps the first implementation small, testable, and reversible.
- No current custom middleware or API gateway throttling layer exists in the repo.

Alternatives:

- API gateway, CDN, or load balancer rate limiting is better for coarse perimeter protection, but it cannot easily key authenticated application actions by user ID or role.
- Express middleware such as `express-rate-limit` is workable, but less idiomatic for Nest route-level policies.
- Redis-backed distributed limiting is better for multi-instance production, but it adds infrastructure and operational scope.

Decision:

- Use `@nestjs/throttler` for application-level throttling now.
- Add gateway/load-balancer throttling later as defense-in-depth.
- Add Redis/shared store only when the backend runs multiple instances or rate limits must be consistent across nodes.

## 2. Client Impact

The proposed limits can affect existing clients if applied too aggressively.

Expected impact by user type:

- Mobile citizens: may hit limits during poor-network retries, repeated report submissions, evidence upload retries, or notification polling.
- Providers: may hit limits while uploading completion evidence, changing statuses, rejecting assignments, or polling assigned work.
- Admin users: may hit limits on dashboard refreshes, audit exports, bulk user workflows, demo generation, backup operations, and repeated provider assignment actions.
- Public onboarding users: may be blocked during repeated registration attempts from the same network, especially shared office/cybercafe/mobile NAT environments.
- Integrations: no explicit integration/webhook endpoints were observed, but any future machine client would need a service-account tier or allowlist.

Mitigation:

- Make all limits environment-configurable.
- Use authenticated user ID as the primary key after JWT auth succeeds.
- Use IP plus normalized identifier for unauthenticated auth flows.
- Avoid very low global limits.
- Add response headers and structured logs for `429` events so false positives can be tuned quickly.

## 3. Exempt Or Carefully Treated Endpoints

### Exempt

No endpoint should be fully exempt from all abuse controls unless required by infrastructure. However, these should avoid strict app-level throttles:

- Internal liveness/readiness health checks if added later.
- Platform or hosting health probes if they call a known path.
- Trusted internal service callbacks, if introduced later and authenticated separately.

Current endpoint to treat carefully:

- `GET /api/platform-tools/maintenance/public`
  - Keep a generous public-read limit.
  - Do not use strict auth/login limits.

### Carefully Treat

Auth endpoints:

- `POST /api/auth/login`
- `POST /api/auth/firebase-login`
- `POST /api/auth/register`
- onboarding registration endpoints

These need strict protection but careful error handling to avoid account enumeration and accidental shared-network lockout.

Upload endpoints:

- `POST /api/report/:id/evidence`
- `POST /api/report/:id/completion-evidence`
- `POST /api/records/evidence`
- `POST /api/identity/kyc/submit`

These need stricter limits than normal reads because they consume memory, CPU, disk, and audit/storage capacity.

Heavy admin endpoints:

- backup create/restore/download/delete
- demo generate/reset/purge
- cache clear
- overdue assignment/dispute processors
- audit export

These should have low per-user limits and strong audit logging.

Webhooks/internal services:

- No webhook endpoints were identified in the current reviewed backend.
- If introduced later, use signature verification plus separate service-tier limits rather than normal browser/mobile limits.

## 4. Limits By Endpoint Risk Level

| Risk level | Endpoint examples | Policy |
| --- | --- | --- |
| Low public read | maintenance public | generous IP limit, no full exemption |
| Normal authenticated read | profile, modules, notifications, report lists | moderate per-user limit |
| Dashboard/reporting read | admin dashboards, audit history, platform readiness | moderate per-user limit with tuning for dashboard refreshes |
| Auth credential | login, firebase-login | strict IP plus identifier limits; generic errors |
| Registration/onboarding | public registration and provider access request | strict IP limits with shared-network caution |
| Upload/evidence | report evidence, completion evidence, KYC, trust evidence | strict per-user limits and body/upload validation |
| Admin mutation | user/org/report/platform changes | lower per-user limits and audit |
| Heavy job | backup, restore, demo generation, purge, cache clear, overdue processors | very low per-user limits and explicit monitoring |

Recommended initial stance:

- Use the design document tiers as staging defaults.
- Validate real dashboard/mobile behavior before production enforcement.
- Prefer permissive-but-observed staging over aggressive first production rollout.

## 5. Upload Hardening Impact

### Existing Uploaded Evidence

Existing records and files should continue to work.

The first hardening pass should not:

- rename existing files
- move existing uploads
- rewrite stored `evidenceImagePath`, `evidenceImageUrl`, `completionImagePath`, or `completionImageUrl`
- block reading old `/uploads/...` links
- require backfill or migrations

Existing evidence may not have the new metadata, digest, MIME validation, or scan status. That is acceptable for the first pass as long as old files are treated as legacy content.

### Future Evidence Uploads

Future uploads will be stricter:

- malformed base64 should be rejected
- empty files should be rejected
- oversized decoded files should be rejected
- declared MIME must match detected file signature
- unsupported image types should be rejected
- suspicious URL/reference evidence should be rejected
- optional image dimension/pixel-count checks may reject very large photos

Client impact:

- Mobile clients may need to compress large photos before upload.
- Clients currently sending non-canonical base64 or wrong content types may fail.
- Clients relying on arbitrary trust evidence URLs may need to use approved HTTPS or application-owned references.

Mitigation:

- Keep error messages clear but not overly detailed.
- Document accepted content types and size limits.
- Consider a short staging observation period before production enforcement.

## 6. Database Migration Requirement

No database migration is required for the approved first implementation pass.

Rate limiting can be implemented without schema changes.

Upload hardening can be implemented without schema changes if it only validates before write and stores the same existing path/url fields.

Potential future migrations, outside this approval:

- upload digest column
- detected MIME column
- byte size column
- scan status column
- protected evidence access table
- evidence lifecycle/quarantine state

## 7. Environment And Configuration Changes

Environment/configuration changes are required or strongly recommended.

Required:

- Rate limit values should be configurable by environment.
- Rate limiting should have a temporary emergency disable switch.
- Proxy/trust configuration must be correct before IP-based enforcement.

Recommended variables:

- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_GLOBAL_TTL_SECONDS`
- `RATE_LIMIT_GLOBAL_LIMIT`
- `RATE_LIMIT_AUTH_TTL_SECONDS`
- `RATE_LIMIT_AUTH_LIMIT`
- `RATE_LIMIT_UPLOAD_TTL_SECONDS`
- `RATE_LIMIT_UPLOAD_LIMIT`
- `RATE_LIMIT_ADMIN_MUTATION_TTL_SECONDS`
- `RATE_LIMIT_ADMIN_MUTATION_LIMIT`
- `RATE_LIMIT_HEAVY_JOB_TTL_SECONDS`
- `RATE_LIMIT_HEAVY_JOB_LIMIT`
- `UPLOAD_MAX_IMAGE_BYTES`
- `UPLOAD_ALLOWED_IMAGE_TYPES`
- `UPLOAD_MAX_IMAGE_PIXELS`
- `UPLOAD_SECURITY_STRICT_MODE`
- `TRUST_PROXY`

No production secret is required for the minimum dependency-free upload validation pass.

If malware scanning is added later, scanner endpoint/API credentials will be required and should be handled as a separate approval item.

## 8. Rollback Capability

The implementation can be rolled back cleanly if kept modular.

Rate limiting rollback:

- Set `RATE_LIMIT_ENABLED=false` if implemented with a config gate.
- Remove or disable the global throttler guard in one revert.
- Revert route-specific throttling decorators.
- No database rollback needed.

Upload hardening rollback:

- Set `UPLOAD_SECURITY_STRICT_MODE=false` if implemented with soft enforcement.
- Revert the centralized upload validation service integration.
- Keep existing file storage paths unchanged.
- No database rollback needed if no schema changes are introduced.

Rollback condition:

- If production clients receive unexpected `429` responses or valid uploads are rejected, disable the relevant enforcement flag first, then investigate with logs.

## 9. Required Acceptance Tests

Before implementation is accepted, these tests must pass.

Existing regression suites:

- `npm test`
- `npm run test:e2e`

Focused existing suites that must remain green:

- `test/auth.e2e-spec.ts`
- `test/report-workflow.e2e-spec.ts`
- `test/trust.e2e-spec.ts`
- `test/platform-tools.e2e-spec.ts`
- `test/demo-environment.e2e-spec.ts`
- `test/organization-management.e2e-spec.ts`
- `test/platform-configuration.e2e-spec.ts`

New rate limiting tests:

- login is throttled after configured attempts
- firebase login is throttled
- public registration/onboarding is throttled
- normal authenticated reads below threshold still pass
- report evidence upload is throttled by authenticated user
- admin heavy job endpoint is throttled
- public maintenance endpoint is not over-throttled
- `429` responses use JSON error shape
- unauthenticated and authenticated tracking keys behave as expected

New upload hardening tests:

- valid JPEG, PNG, and WebP uploads still succeed
- malformed base64 is rejected
- empty decoded payload is rejected
- decoded payload above the limit is rejected
- declared MIME/signature mismatch is rejected
- unsupported signature is rejected
- generated paths remain inside upload root
- existing report evidence happy path still stores existing path/url fields
- trust evidence rejects `file:`, `data:`, `javascript:`, localhost, private-network, and malformed URLs
- trust evidence accepts approved HTTPS or approved local application-owned references
- KYC document references follow the same URL policy

Manual/staging validation:

- mobile citizen can register, log in, create a report, upload evidence, and view notifications
- provider can log in, view assigned reports, upload completion evidence, and update status
- admin can view dashboards, assign/reassign reports, manage users, export audit data, and run platform tools within expected limits
- repeated dashboard refreshes do not trigger false positive throttling
- large real-world phone photos receive clear validation results

## 10. Main Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Shared mobile NAT causes false `429`s | Citizens/providers blocked | user-ID keys after auth; moderate public limits; staging tuning |
| Proxy headers misconfigured | all users share one bucket or spoofing bypass occurs | configure trusted proxy explicitly; test forwarded IP behavior |
| Auth throttling leaks account existence | enumeration risk | generic auth errors and consistent response timing/body |
| Limits too strict for admin dashboards | operations disruption | separate dashboard read tier and monitor `429`s |
| Upload hardening rejects valid field photos | evidence workflow disruption | document limits; allow frontend compression; tune size/dimension caps |
| Manual MIME checks miss complex malicious files | residual malware risk | scanner interface and future malware scanning integration |
| Public `/uploads` remains accessible | evidence confidentiality risk | keep as known residual risk; plan protected delivery separately |
| In-memory rate limits fail across instances | inconsistent enforcement | accept only for single-node; add shared store before horizontal scaling |
| Rollback is incomplete | prolonged outage | config gates plus modular implementation and no migrations |

## Exact Implementation Sequence

Approved sequence:

1. Add feature flags and environment-driven configuration for rate limiting and upload strictness.
2. Add `@nestjs/throttler` and a dedicated rate-limit module.
3. Configure global throttling with conservative defaults.
4. Add custom tracking only if needed to support authenticated user ID plus unauthenticated IP/identifier behavior.
5. Add route-specific throttling decorators by risk tier.
6. Add rate limiting e2e tests and verify existing auth/report/trust/admin behavior.
7. Build a central upload security service without changing route contracts.
8. Route report evidence and completion evidence writes through the upload security service.
9. Add trust/KYC evidence reference validation.
10. Add upload hardening tests.
11. Run full unit and e2e regression.
12. Deploy first to staging with `429` and upload rejection logging monitored.
13. Tune limits before production rollout.

## Exact Rollback Plan

1. If rate limiting causes client disruption, set `RATE_LIMIT_ENABLED=false`.
2. If upload validation causes false rejections, set `UPLOAD_SECURITY_STRICT_MODE=false` or equivalent soft-enforcement flag.
3. If config flags are insufficient, revert the implementation commit that imports the rate-limit/upload-security modules.
4. Re-run auth, report workflow, trust, and platform tools e2e tests after rollback.
5. Do not run migrations or data repair for rollback, because the approved first pass must not change schema or stored file paths.

## Approval Conditions

Implementation is approved only if:

- No database migration is included.
- Existing uploaded evidence remains accessible.
- Public `/uploads` behavior is not changed without separate approval.
- Limits are configurable and can be disabled.
- Proxy/IP behavior is explicitly tested.
- New tests cover throttling, upload validation, and existing happy paths.
- Production rollout is staged and monitored before strict enforcement.
