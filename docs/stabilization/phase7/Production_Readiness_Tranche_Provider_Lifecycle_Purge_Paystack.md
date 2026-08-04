# Production Readiness Tranche: Provider Analytics, Lifecycle, Purge, Paystack

Date: 2026-08-04

## Executive Status

PASS WITH NOTES for the implemented local tranche.

No production deployment, push, database reset, live payment configuration, or demo purge execution was performed.

## Provider Metric Definitions

Average provider response time is now defined as:

1. report assigned to provider: `Report.assignedAt`;
2. provider accepted work: first `ReportActivity` with action `PROVIDER_STARTED_WORK` by the same provider;
3. valid sample: acceptance timestamp exists, assignment timestamp exists, acceptance is after assignment, provider identity matches, and report is in `IN_PROGRESS`, `COMPLETED_BY_PROVIDER`, or `CLOSED`.

The metric excludes pending, rejected, expired, cancelled, cross-provider, missing timestamp, and malformed samples. It returns:

- `averageResponseHours`: numeric value or `null`;
- `averageResponseSampleCount`;
- `averageResponseReason`, including `NO_ACCEPTED_ASSIGNMENTS`, `MISSING_ASSIGNMENT_TIMESTAMP`, or `MISSING_ACCEPTANCE_TIMESTAMP`.

`Total Completed` remains scoped to the provider records loaded from the backend endpoint. For organization admins, the backend restricts assigned reports to the admin organization. For Super Admins, the provider performance endpoint remains platform-wide unless a narrower endpoint is used.

## Account Lifecycle Matrix

| Entity | Active | Deactivate/Suspend | Reactivate | Archive/Restore | Hard Delete |
| --- | --- | --- | --- | --- | --- |
| User | Can authenticate if `accountStatus=ACTIVE` | Admin status endpoint sets non-active status; login is rejected | Admin status endpoint can restore `ACTIVE` | Not modelled separately for users yet | Not exposed as a governed production action |
| Provider | Same as user plus provider assignment checks | Deactivated/suspended providers cannot authenticate or accept work | Can be activated by authorized admin | Organization membership can be inactive; full provider archive remains future work | Blocked by policy where reports/evidence/history exist |
| Organization | `Organization.status=ACTIVE` can receive routing/work | Status/archive controls exist in organization service | Restore/reactivation exists through status update paths | Archive prevents active operational use | Hard delete not exposed for protected production records |
| Super Admin | Must retain at least one active account | Final active Super Admin deactivation is now blocked | Other Super Admins may reactivate | Not applicable | Self/final-admin destructive lockout remains blocked by policy |

## Deletion Versus Archive Policy

Historical reports, evidence, ratings, disputes, audit logs, payment/subscription records, and operational history must remain readable to authorized users. Deactivation/archive is the default lifecycle action when dependencies exist. Hard delete should be reserved for explicitly safe, dependency-free records or deterministic demo/test data under the governed purge workflow.

## Email/Profile Editing Flow

Current safe profile editing supports governed updates for non-identity profile/contact fields through existing profile/admin endpoints. Provider admin email edits currently normalize uniqueness and reset verification status, but the full pending-email verification state is not yet schema-backed.

Required remaining work before marking email identity changes production-complete:

- add durable pending email change state;
- verify new email before replacing login identity;
- require current password or OTP re-verification for sensitive identity changes;
- refresh/revoke sessions according to the final token/session design;
- audit old/new safe metadata without exposing secrets.

## Demo Data Classification

Deterministic demo classification uses existing markers:

- `isDemo=true`;
- `demoBatchId`;
- `demoScenario`;
- `demoGeneratedAt`.

The purge preview separately counts uncertain records where demo batch metadata exists but `isDemo=false`. Execution is blocked while uncertain records are present.

## Purge Preservation/Deletion Matrix

Preview groups deletion counts for organizations, users/citizens, providers, memberships, invitations, reports, assignments, evidence/files, discussions, notifications, ratings/reviews, disputes, subscriptions, invoices/payment attempts, analytics/cache records, generated demo backups, and audit logs.

Preserved:

- designated Super Admin;
- system roles and permissions;
- application configuration;
- service/reference definitions;
- subscription plan and entitlement definitions;
- payment provider configuration references without secrets;
- schema/migration state;
- audit capability.

## Purge Runbook And Rollback

1. Take or verify a fresh backup and record the backup reference.
2. Open Super Admin Platform Tools.
3. Run demo purge preview.
4. Confirm uncertain record counts are zero.
5. Enter backup reference, reauthentication evidence, preserved Super Admin id, reason, and exact phrase `PURGE DEMO DATA`.
6. Execute only after the preview remains acceptable.
7. Review execution id, deleted counts, preserved summary, skipped records, and failed file operations.
8. If a failure occurs, stop further purge attempts and restore/reconcile from the verified backup using the governed operational backup process.

## Go-Live Lock

The backend checks platform setting `demo_purge_locked`. When set to `true`, governed demo purge execution is rejected with `DEMO_PURGE_LOCKED`. This should be enabled after final go-live unless an exceptional governed process unlocks it.

## Paystack Activation Checklist

Current state:

- Backend has subscription/billing fields on users and organizations, plan governance, and manual entitlement checks.
- Frontend revenue screens explicitly state manual invoice workflow and no live payment capture.
- No live Paystack secret, webhook endpoint, transaction model, verified signature handler, refund/dispute model, or reconciliation job was found in the backend.

Before real Paystack activation:

- add server-side Paystack initialization endpoint;
- store transaction reference with uniqueness and idempotency key;
- verify amount and currency server-side;
- verify webhook signatures using environment secrets without logging them;
- make webhook processing idempotent;
- activate subscriptions only after verified successful payment;
- separate test-mode and live-mode configuration;
- redact secrets, authorization headers, OTPs, password hashes, and webhook raw secrets from logs;
- implement retry/reconciliation handling;
- define refund, chargeback, and dispute handling;
- add e2e tests for success, duplicate webhook, tampered amount, bad signature, retry, and failed payment.

