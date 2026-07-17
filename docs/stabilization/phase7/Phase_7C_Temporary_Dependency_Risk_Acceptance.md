# Phase 7C Temporary Dependency Risk Acceptance

Date: 2026-07-17

## Finding

Package: `websocket-driver@0.7.4`

Dependency chain:

```text
firebase-admin
-> @firebase/database-compat
-> @firebase/database
-> faye-websocket
-> websocket-driver
```

Classification: **LOW PRACTICAL EXPOSURE**

## Current Controls

- `firebase-admin` is not imported in the audited production Nest runtime.
- Firebase Realtime Database is not used.
- Public API input is not routed into this WebSocket chain.
- No vulnerable application flow was identified.
- Upload paths use strict base64 image validation and local path containment.
- JWT, role guards, CORS restrictions, rate limiting, monitoring, and rollback controls exist.

## Risk Acceptance Status

**RISK ACCEPTANCE NOT FINALIZED**

The dependency disposition was approved for deployment-authorization review, but final deployment execution requires a formal acceptance record.

## Required Acceptance Record

| Field | Status |
| --- | --- |
| Release scope | REQUIRED |
| Acceptance owner | REQUIRED |
| Acceptance date | REQUIRED |
| Expiry/review date | REQUIRED |
| Follow-up remediation owner | REQUIRED |
| Required dependency-remediation tranche | REQUIRED |
| Invalidating condition | REQUIRED |

Invalidating condition:

Any new production use of Firebase Realtime Database or any new `firebase-admin` runtime path that invokes Realtime Database/WebSocket transport invalidates this acceptance and requires re-triage before deployment.

## Required Follow-Up Tranche

After release authorization, open a dependency remediation tranche to:

1. Evaluate `firebase-admin` major-version upgrade impact.
2. Evaluate compatible NestJS patch releases for routing/upload/config advisories.
3. Evaluate targeted npm overrides only with clean reinstall/build/unit/e2e/Flutter validation.
4. Avoid broad `npm audit fix` or unreviewed major dependency movement.

## Deployment Gate

Deployment execution must not proceed until this document is completed with owner, dates, scope, and follow-up responsibility.
