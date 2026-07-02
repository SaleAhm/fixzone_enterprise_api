-- SecureZone v3.2 Trust Automation & Enforcement Controls
ALTER TABLE "DisputeCase"
  ADD COLUMN "assignedAdminId" TEXT,
  ADD COLUMN "escalatedAt" TIMESTAMP(3);

CREATE INDEX "DisputeCase_assignedAdminId_idx" ON "DisputeCase"("assignedAdminId");
