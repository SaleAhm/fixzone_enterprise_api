# Phase 7C Dependency Security Triage

Date: 2026-07-17

## Scope

This triage inspected backend dependencies for the Phase 7C-D release candidate. No dependency changes, source changes, production access, deployment, migration execution, Dokploy changes, secret changes, branch merges, or tag movement occurred.

Audited backend revision: `8ac1fe609ccabe82ddea2ba4235d68ef37af6e5c`

## Tooling Evidence

| Item | Value |
| --- | --- |
| Node | `v22.19.0` |
| npm | `10.9.3` |
| NestJS core | `11.1.17` |
| Prisma CLI | `7.6.0` |
| Prisma Client | `7.6.0` |
| PostgreSQL adapter | `@prisma/adapter-pg@7.6.0` |
| PostgreSQL client | `pg@8.20.0` |
| Firebase Admin | `firebase-admin@13.9.0` |
| Upload stack | Base64 image DTOs and local `UploadSecurityService`; no Multer route usage found |

Commands run:

- `npm audit --omit=dev --json`
- `npm audit --json`
- `npm ls --all --json`
- `npm why websocket-driver`
- `npm why firebase-admin`
- `npm why multer`
- `npm why path-to-regexp`
- `npm why lodash`
- `npm why @grpc/grpc-js`

## Vulnerability Totals

| Audit | Total | Critical | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: | ---: |
| Production tree, `npm audit --omit=dev` | 25 | 1 | 12 | 12 | 0 |
| Full tree, `npm audit` | 35 | 1 | 13 | 20 | 1 |

## Production-Relevant Inventory

| Package | Severity | Direct | Installed | Dependency path | SecureZone feature | Reachability | Recommended action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `websocket-driver` | Critical | Transitive | `0.7.4` | `firebase-admin -> @firebase/database-compat -> @firebase/database -> faye-websocket -> websocket-driver` | Firebase Realtime Database transport, not Nest API | LOW PRACTICAL EXPOSURE | Remediate in approved dependency tranche; do not block if risk is accepted with conditions. |
| `@grpc/grpc-js` | High | Transitive optional | `1.14.3` | `firebase-admin -> @google-cloud/firestore -> google-gax -> @grpc/grpc-js` | Firebase/Firestore script path | LOW PRACTICAL EXPOSURE for Nest runtime | Patch via Firebase/Admin dependency review. |
| `@nestjs/core` / `path-to-regexp` | High | Direct plus transitive | `11.1.17` / `8.3.0` | Nest/Express routing | Public HTTP routing | POTENTIALLY EXPLOITABLE as routing DoS class | Evaluate safe Nest patch release when available; keep rate limiting and monitoring. |
| `@nestjs/platform-express` / `multer` | High | Direct plus transitive | `11.1.17` / `2.1.1` | Nest platform adapter | Upload dependency present | LOW PRACTICAL EXPOSURE because app uses base64 DTO upload service, not Multer interceptors | Patch through Nest platform update; current upload paths remain guarded. |
| `@nestjs/config` / `lodash` | High | Direct plus transitive | `4.0.3` / `4.17.23` | Config module | Environment/config parsing | LOW PRACTICAL EXPOSURE if config objects are trusted server-side | Patch through `@nestjs/config` release or override after validation. |
| `defu` | High | Transitive | `6.1.4` | Prisma tooling chain | Prisma CLI/config tooling | LOW PRACTICAL EXPOSURE at runtime | Track Prisma patch; runtime app does not call Prisma dev server code. |
| `fast-uri` | High | Transitive | `3.1.0` / `3.1.1` nodes | AJV / tooling and validators | Schema parsing | LOW to POTENTIAL depending call site | Patch via parent package update or override after validation. |
| `form-data` | High | Transitive | affected nodes in full tree | Type/request tooling and production dependency node | HTTP multipart helper | LOW PRACTICAL EXPOSURE in Nest runtime | Patch via parent dependency update; no direct multipart outbound flow found. |
| `hono` / `@hono/node-server` | High/Moderate | Transitive | vulnerable | Prisma dev tooling | Prisma Studio/dev tooling | NOT REACHABLE IN PRODUCTION Nest runtime | Do not block deployment; track Prisma tooling updates. |
| `protobufjs` | High | Transitive | vulnerable | Google/Firebase/gRPC chain | Firebase/Google APIs | LOW PRACTICAL EXPOSURE for Nest runtime | Patch through Firebase/Admin chain. |

## Critical Finding Analysis

Critical package: `websocket-driver@0.7.4`

Advisories:

- `GHSA-mp7j-qc5w-4988`: resource limit bypass via message compression.
- `GHSA-xv26-6w52-cph6`: message corruption via protocol length headers.

Dependency chain:

```text
firebase-admin@13.9.0
  -> @firebase/database-compat@2.1.4
    -> @firebase/database@1.1.3
      -> faye-websocket@0.11.4
        -> websocket-driver@0.7.4
```

Why it exists:

- `firebase-admin` depends on Firebase Realtime Database compatibility packages.
- Those packages include WebSocket transport support.

Reachability review:

- `rg` found no production Nest imports of `firebase-admin`.
- `firebase-admin` usage is limited to `scripts/seed-firebase-provider.ts`, which uses Firebase Auth and Firestore for a seed/maintenance workflow.
- The production Nest `firebase-login` route does not verify a Firebase token server-side and does not instantiate the Firebase Admin SDK. It accepts Firebase UID/profile data and stores it in Prisma.
- No code path calls `admin.database()`, `getDatabase()`, or Firebase Realtime Database.
- Uploads use base64 DTOs and `UploadSecurityService`; they do not route through `websocket-driver`.
- Authentication, API request parsing, template rendering, Prisma/database access, and logging do not load or invoke `websocket-driver` in the current Nest runtime.

Exploitability classification: **LOW PRACTICAL EXPOSURE**

Rationale:

- The vulnerable package is present in `node_modules`, but the affected Realtime Database WebSocket transport is not invoked by the production Nest app.
- Untrusted public API input cannot reasonably reach `websocket-driver` through the audited runtime routes.
- If a future production task runs Firebase Realtime Database code or expands Firebase Admin usage, this classification must be revisited before deployment.

## Remediation Options

### Option A: Safe direct patch/minor update

- Candidate: update direct parents such as `@nestjs/*`, `firebase-admin`, or `@nestjs/config` only when maintainers publish compatible patch/minor releases.
- Files changed: `package.json`, `package-lock.json`.
- Lockfile impact: narrow if exact package chain is patched.
- Test impact: full backend clean validation and Flutter validation required.
- Breaking risk: low only if patch/minor and release notes confirm compatibility.
- Migration impact: none expected.

### Option B: npm overrides

- Candidate: override vulnerable transitive packages such as `websocket-driver`, `path-to-regexp`, `multer`, `lodash`, or `@grpc/grpc-js` only after compatibility is tested against parent packages.
- Files changed: `package.json`, `package-lock.json`.
- Lockfile impact: can be narrow, but may be risky if parent packages assume older APIs.
- Test impact: full clean backend and Flutter validation required.
- Breaking risk: medium for routing/upload/runtime packages.
- Migration impact: none expected.

### Option C: Upstream package upgrade

- Candidate: `firebase-admin@14.2.0` for Firebase chain, newer Nest packages for routing/upload/config advisories.
- Files changed: `package.json`, `package-lock.json`.
- Lockfile impact: potentially broad.
- Test impact: full clean backend and Flutter validation required.
- Breaking risk: medium to high for major updates.
- Migration impact: none expected.

### Option D: Documented risk acceptance with compensating controls

- Accept low practical exposure for `websocket-driver` for this deployment authorization phase.
- Compensating controls: no Realtime Database production usage, no production seed script execution during deployment, API rate limits, upload size/type/path validation, CORS allow-list, JWT guards, monitoring for 4xx/5xx/auth/upload anomalies.
- Deployment impact: does not automatically block controlled deployment authorization if production backup/restore and pre-flight gates pass.

## Recommendation

Do not make dependency changes in Phase 7C-D. The critical finding is present but not reachable in the current production Nest runtime. Proceed only as **READY WITH CONDITIONS**, with explicit risk acceptance for this release and a follow-up approved dependency remediation tranche.

Recommended next security tranche:

1. Evaluate compatible Nest patch releases for `@nestjs/core`, `@nestjs/platform-express`, and `@nestjs/config`.
2. Evaluate `firebase-admin` major upgrade impact separately.
3. Test npm overrides only in a branch with clean reinstall/build/unit/e2e/Flutter validation.
4. Avoid broad `npm audit fix` and any unreviewed major dependency movement.
