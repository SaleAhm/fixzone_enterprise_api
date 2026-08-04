ALTER TABLE "Report"
ADD COLUMN "completionReviewProcessedAt" TIMESTAMP(3),
ADD COLUMN "completionFallbackRule" TEXT,
ADD COLUMN "completionFinalActorType" TEXT,
ADD COLUMN "completionGovernanceHoldReason" TEXT;
