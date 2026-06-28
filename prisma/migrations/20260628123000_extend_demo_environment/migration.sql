ALTER TABLE "Organization"
ADD COLUMN "demoScenario" TEXT,
ADD COLUMN "demoGeneratedAt" TIMESTAMP(3);

ALTER TABLE "User"
ADD COLUMN "demoScenario" TEXT,
ADD COLUMN "demoGeneratedAt" TIMESTAMP(3);

ALTER TABLE "Report"
ADD COLUMN "demoScenario" TEXT,
ADD COLUMN "demoGeneratedAt" TIMESTAMP(3);

ALTER TABLE "Notification"
ADD COLUMN "demoScenario" TEXT,
ADD COLUMN "demoGeneratedAt" TIMESTAMP(3);

CREATE TABLE "DemoAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "demoBatchId" TEXT,
    "scenario" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Organization_demoScenario_idx" ON "Organization"("demoScenario");
CREATE INDEX "User_demoScenario_idx" ON "User"("demoScenario");
CREATE INDEX "Report_demoScenario_idx" ON "Report"("demoScenario");
CREATE INDEX "Notification_demoScenario_idx" ON "Notification"("demoScenario");
CREATE INDEX "DemoAuditLog_action_idx" ON "DemoAuditLog"("action");
CREATE INDEX "DemoAuditLog_actorUserId_idx" ON "DemoAuditLog"("actorUserId");
CREATE INDEX "DemoAuditLog_demoBatchId_idx" ON "DemoAuditLog"("demoBatchId");
CREATE INDEX "DemoAuditLog_createdAt_idx" ON "DemoAuditLog"("createdAt");
