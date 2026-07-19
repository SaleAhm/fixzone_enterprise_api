-- Phase 7B-H Segment E: manual monetization upgrade request workflow.
CREATE TYPE "UpgradeRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED'
);

CREATE TABLE "OrganizationUpgradeRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "currentPlan" "SubscriptionPlan" NOT NULL,
  "requestedPlan" "SubscriptionPlan" NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" "UpgradeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestNote" TEXT,
  "reviewNote" TEXT,
  "reviewedByUserId" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationUpgradeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationUpgradeRequest_organizationId_status_idx"
  ON "OrganizationUpgradeRequest"("organizationId", "status");

CREATE INDEX "OrganizationUpgradeRequest_requestedPlan_idx"
  ON "OrganizationUpgradeRequest"("requestedPlan");

CREATE INDEX "OrganizationUpgradeRequest_requestedByUserId_idx"
  ON "OrganizationUpgradeRequest"("requestedByUserId");

CREATE INDEX "OrganizationUpgradeRequest_reviewedByUserId_idx"
  ON "OrganizationUpgradeRequest"("reviewedByUserId");

ALTER TABLE "OrganizationUpgradeRequest"
  ADD CONSTRAINT "OrganizationUpgradeRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
