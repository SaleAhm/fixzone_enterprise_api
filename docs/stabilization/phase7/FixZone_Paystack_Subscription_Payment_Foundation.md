# FixZone Paystack Subscription Payment Foundation

## Scope

This backend tranche establishes a default-off Paystack payment foundation for organization subscription payments and entitlement activation. It does not process live payments, deploy, migrate production, touch retained UAT records, or enable enterprise foundations.

## Existing monetization baseline

- `Organization.subscriptionPlan`, `billingStatus`, quota fields and manual `OrganizationUpgradeRequest` already existed.
- `User.subscriptionPlan` and `UserEntitlement` already existed for trust/module access policy.
- Prior frontend billing screens were truthful manual-governance placeholders.
- No production-capable payment transaction, subscription, receipt, Paystack adapter, webhook or reconciliation service existed before this tranche.

## Architecture

- `PaymentsModule` owns payment APIs and domain orchestration.
- `PaymentProviderAdapter` is the provider abstraction.
- `PaystackPaymentAdapter` isolates Paystack HTTP payloads, HMAC verification and normalized transaction parsing.
- `PaymentsService` owns server-controlled plan resolution, transaction initialization, trusted verification, webhook handling, idempotent fulfillment and reconciliation.

## Plan authority

Plans are defined server-side in `plan-catalog.ts` with stable plan code, localization keys, billing interval, currency, integer minor-unit amount and maintenance-only entitlements. Values are placeholder test pricing and are not commercial-release pricing. The `ENTERPRISE` plan remains inactive so payments cannot activate unfinished enterprise foundations.

## Data model

The additive migration creates:

- `PaymentTransaction`
- `OrganizationSubscription`
- `PaymentReceipt`
- payment provider/environment/status enums

Normalized columns store reference, amount, currency, status, timestamps and indexes. Sanitized JSON stores only small provider metadata needed for reconciliation. Card data, authorization payloads, raw webhook bodies and secrets are not stored.

## Payment flow

Initialization:

1. Authenticated organization billing user submits a server-known plan code.
2. Backend resolves amount/currency/entitlements from the catalogue.
3. Backend creates an internal reference and pending transaction.
4. Paystack initialization returns safe checkout data only.
5. No entitlement is activated during initialization.

Verification and webhook:

- Browser callbacks are UX only.
- Trusted backend verification or valid Paystack webhook drives fulfillment.
- Amount, currency and reference must match internal records.
- Mismatches move to `REVIEW_REQUIRED`.

Fulfillment:

- Marks payment paid/verified.
- Creates/updates organization subscription facts.
- Applies maintenance-only organization quotas.
- Completes compatible pending upgrade requests.
- Creates receipt facts and in-app notification.
- Duplicate successful delivery returns the existing paid transaction without duplicating subscription or receipt.

## Configuration

Payments are default-off with `PAYMENTS_ENABLED=false`. If enabled, startup fails safely unless Paystack secret and callback base URL are configured. Live mode rejects test-like keys.

## Webhook boundary

`configure-app.ts` preserves the exact raw body only for `/payments/webhooks/paystack`. The adapter validates `x-paystack-signature` with HMAC SHA-512 and constant-time comparison.

## Reconciliation

`POST /api/payments/admin/reconcile` is an explicit Super Admin boundary for later scheduling approval. It scans stale pending/processing transactions within bounded limits and invokes the same fulfillment path.

## Frontend integration contract

- `GET /api/payments/plans`
- `POST /api/payments/organization/:organizationId/initialize` with `{ "planCode": "STARTER" }`
- `GET /api/payments/organization/:organizationId/transactions/:reference`
- `POST /api/payments/organization/:organizationId/transactions/:reference/verify`
- `GET /api/payments/organization/:organizationId/history`
- `GET /api/payments/organization/:organizationId/receipts/:receiptNumber`
- `GET /api/payments/organization/:organizationId/subscription`

Frontend must never send or trust amounts, currency, success flags or entitlement activation. It should use `authorizationUrl`, `accessCode`, `reference`, status codes and localization keys from the backend.

## Limitations and launch risks

- Paystack calls are implemented but must be exercised only with test credentials until commercial release approval.
- Placeholder prices require commercial approval before live mode.
- Refund/downgrade entitlement policy is recorded as state but not automated beyond forward-compatible facts.
- No citizen fees, provider payouts, escrow, job settlement or marketplace payments are included.
- Remaining dependency audit findings remain commercial-release work.
