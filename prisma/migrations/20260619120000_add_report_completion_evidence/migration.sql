ALTER TABLE "Report"
ADD COLUMN "completionNote" TEXT,
ADD COLUMN "completionImageUrl" TEXT,
ADD COLUMN "completionImagePath" TEXT,
ADD COLUMN "completedByProviderAt" TIMESTAMP(3);
