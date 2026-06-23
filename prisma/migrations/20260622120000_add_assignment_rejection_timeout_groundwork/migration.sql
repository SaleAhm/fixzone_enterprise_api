CREATE TYPE "AssignmentOutcome" AS ENUM ('REJECTED', 'TIMED_OUT');

ALTER TABLE "Report"
ADD COLUMN "assignedAt" TIMESTAMP(3),
ADD COLUMN "assignmentDeadlineAt" TIMESTAMP(3),
ADD COLUMN "lastAssignmentOutcome" "AssignmentOutcome",
ADD COLUMN "lastAssignmentReason" TEXT,
ADD COLUMN "lastAssignmentAt" TIMESTAMP(3),
ADD COLUMN "lastAssignmentProviderId" TEXT;

ALTER TABLE "Report"
ADD COLUMN "citizenRating" INTEGER,
ADD COLUMN "citizenFeedback" TEXT,
ADD COLUMN "completionRejectionReason" TEXT;
