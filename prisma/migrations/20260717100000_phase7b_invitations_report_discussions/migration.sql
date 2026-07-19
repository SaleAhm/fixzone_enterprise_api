-- Phase 7B: additive invitation lifecycle and report-scoped discussion foundation.

ALTER TYPE "InvitationStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

ALTER TABLE "Invitation"
  ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "resentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastNotificationAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Invitation_tokenHash_idx" ON "Invitation"("tokenHash");

CREATE TABLE IF NOT EXISTS "ReportMessage" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorRole" "UserRole" NOT NULL,
  "authorName" TEXT,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReportMessage_reportId_createdAt_idx" ON "ReportMessage"("reportId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReportMessage_organizationId_createdAt_idx" ON "ReportMessage"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReportMessage_authorId_createdAt_idx" ON "ReportMessage"("authorId", "createdAt");

ALTER TABLE "ReportMessage"
  ADD CONSTRAINT "ReportMessage_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportMessage"
  ADD CONSTRAINT "ReportMessage_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
