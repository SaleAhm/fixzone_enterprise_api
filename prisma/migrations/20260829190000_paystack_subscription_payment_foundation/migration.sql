-- Paystack subscription payment foundation.
-- Additive only: preserves existing organization billing/manual upgrade rows.

CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK');
CREATE TYPE "PaymentEnvironment" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "PaymentTransactionStatus" AS ENUM (
  'INITIALIZED',
  'PENDING',
  'PROCESSING',
  'PAID',
  'VERIFIED',
  'FAILED',
  'ABANDONED',
  'EXPIRED',
  'REFUNDED',
  'REVIEW_REQUIRED'
);
CREATE TYPE "OrganizationSubscriptionStatus" AS ENUM (
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED'
);
CREATE TYPE "PaymentReceiptStatus" AS ENUM ('ISSUED', 'REFUNDED', 'VOIDED');

CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requestingUserId" TEXT,
  "provider" "PaymentProvider" NOT NULL,
  "environment" "PaymentEnvironment" NOT NULL,
  "internalReference" TEXT NOT NULL,
  "providerReference" TEXT,
  "providerAccessCode" TEXT,
  "providerAuthorizationUrl" TEXT,
  "planCode" "SubscriptionPlan" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'INITIALIZED',
  "initializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "abandonedAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "providerEventReference" TEXT,
  "lastReconciledAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "sanitizedMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationSubscription" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planCode" "SubscriptionPlan" NOT NULL,
  "status" "OrganizationSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentPeriodStartAt" TIMESTAMP(3) NOT NULL,
  "currentPeriodEndAt" TIMESTAMP(3),
  "sourceTransactionId" TEXT,
  "externalCustomerRef" TEXT,
  "externalSubscriptionRef" TEXT,
  "entitlementAppliedAt" TIMESTAMP(3),
  "cancellationRequestedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentReceipt" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "organizationName" TEXT NOT NULL,
  "planCode" "SubscriptionPlan" NOT NULL,
  "planNameKey" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerReference" TEXT,
  "status" "PaymentReceiptStatus" NOT NULL DEFAULT 'ISSUED',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentTransaction_internalReference_key"
  ON "PaymentTransaction"("internalReference");

CREATE UNIQUE INDEX "PaymentTransaction_provider_providerReference_key"
  ON "PaymentTransaction"("provider", "providerReference");

CREATE INDEX "PaymentTransaction_organizationId_status_idx"
  ON "PaymentTransaction"("organizationId", "status");

CREATE INDEX "PaymentTransaction_organizationId_createdAt_idx"
  ON "PaymentTransaction"("organizationId", "createdAt");

CREATE INDEX "PaymentTransaction_requestingUserId_createdAt_idx"
  ON "PaymentTransaction"("requestingUserId", "createdAt");

CREATE INDEX "PaymentTransaction_provider_environment_status_idx"
  ON "PaymentTransaction"("provider", "environment", "status");

CREATE INDEX "PaymentTransaction_planCode_idx"
  ON "PaymentTransaction"("planCode");

CREATE UNIQUE INDEX "OrganizationSubscription_sourceTransactionId_key"
  ON "OrganizationSubscription"("sourceTransactionId");

CREATE INDEX "OrganizationSubscription_organizationId_status_idx"
  ON "OrganizationSubscription"("organizationId", "status");

CREATE INDEX "OrganizationSubscription_planCode_idx"
  ON "OrganizationSubscription"("planCode");

CREATE INDEX "OrganizationSubscription_currentPeriodEndAt_idx"
  ON "OrganizationSubscription"("currentPeriodEndAt");

CREATE UNIQUE INDEX "PaymentReceipt_transactionId_key"
  ON "PaymentReceipt"("transactionId");

CREATE UNIQUE INDEX "PaymentReceipt_receiptNumber_key"
  ON "PaymentReceipt"("receiptNumber");

CREATE INDEX "PaymentReceipt_organizationId_paidAt_idx"
  ON "PaymentReceipt"("organizationId", "paidAt");

CREATE INDEX "PaymentReceipt_planCode_idx"
  ON "PaymentReceipt"("planCode");

ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_requestingUserId_fkey"
  FOREIGN KEY ("requestingUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrganizationSubscription"
  ADD CONSTRAINT "OrganizationSubscription_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationSubscription"
  ADD CONSTRAINT "OrganizationSubscription_sourceTransactionId_fkey"
  FOREIGN KEY ("sourceTransactionId") REFERENCES "PaymentTransaction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentReceipt"
  ADD CONSTRAINT "PaymentReceipt_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentReceipt"
  ADD CONSTRAINT "PaymentReceipt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
