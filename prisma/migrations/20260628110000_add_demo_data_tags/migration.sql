ALTER TABLE "Organization"
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "demoBatchId" TEXT,
ADD COLUMN "createdBySuperAdminId" TEXT;

ALTER TABLE "User"
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "demoBatchId" TEXT,
ADD COLUMN "createdBySuperAdminId" TEXT;

ALTER TABLE "Report"
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "demoBatchId" TEXT,
ADD COLUMN "createdBySuperAdminId" TEXT;

ALTER TABLE "Notification"
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "demoBatchId" TEXT,
ADD COLUMN "createdBySuperAdminId" TEXT;

CREATE INDEX "Organization_isDemo_idx" ON "Organization"("isDemo");
CREATE INDEX "Organization_demoBatchId_idx" ON "Organization"("demoBatchId");
CREATE INDEX "User_isDemo_idx" ON "User"("isDemo");
CREATE INDEX "User_demoBatchId_idx" ON "User"("demoBatchId");
CREATE INDEX "Report_isDemo_idx" ON "Report"("isDemo");
CREATE INDEX "Report_demoBatchId_idx" ON "Report"("demoBatchId");
CREATE INDEX "Notification_isDemo_idx" ON "Notification"("isDemo");
CREATE INDEX "Notification_demoBatchId_idx" ON "Notification"("demoBatchId");
