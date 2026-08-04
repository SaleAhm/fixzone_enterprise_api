CREATE TYPE "CompletionPolicy" AS ENUM (
  'CITIZEN_CONFIRMATION_REQUIRED',
  'ORGANIZATION_CONFIRMATION_REQUIRED',
  'BOTH_REQUIRED',
  'CITIZEN_OR_ORGANIZATION',
  'ADMIN_RESOLUTION_REQUIRED',
  'AUTO_CLOSE_AFTER_REVIEW_WINDOW'
);

CREATE TYPE "CompletionDecision" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'VERIFIED',
  'REWORK_REQUESTED',
  'DISPUTED',
  'ESCALATED'
);

ALTER TABLE "Report"
ADD COLUMN "completionPolicy" "CompletionPolicy",
ADD COLUMN "completionPolicySource" TEXT,
ADD COLUMN "completionReviewState" TEXT,
ADD COLUMN "completionReviewDeadlineAt" TIMESTAMP(3),
ADD COLUMN "citizenCompletionDecision" "CompletionDecision",
ADD COLUMN "citizenCompletionDecidedAt" TIMESTAMP(3),
ADD COLUMN "organizationCompletionDecision" "CompletionDecision",
ADD COLUMN "organizationCompletionDecidedAt" TIMESTAMP(3),
ADD COLUMN "organizationCompletionDecidedById" TEXT,
ADD COLUMN "organizationCompletionReason" TEXT,
ADD COLUMN "completionFinalizedAt" TIMESTAMP(3),
ADD COLUMN "completionFinalizedById" TEXT,
ADD COLUMN "completionFinalizedByRole" "UserRole",
ADD COLUMN "completionClosureReason" TEXT,
ADD COLUMN "completionDisputeReason" TEXT;

CREATE INDEX "Report_completionPolicy_idx" ON "Report"("completionPolicy");
CREATE INDEX "Report_completionReviewState_idx" ON "Report"("completionReviewState");
CREATE INDEX "Report_completionReviewDeadlineAt_idx" ON "Report"("completionReviewDeadlineAt");
