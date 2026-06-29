-- Extend organization type taxonomy for enterprise tenants.
ALTER TYPE "OrganizationType" ADD VALUE IF NOT EXISTS 'GOVERNMENT';
ALTER TYPE "OrganizationType" ADD VALUE IF NOT EXISTS 'FEDERAL_AGENCY';
ALTER TYPE "OrganizationType" ADD VALUE IF NOT EXISTS 'STATE_AGENCY';
ALTER TYPE "OrganizationType" ADD VALUE IF NOT EXISTS 'UNIVERSITY';
ALTER TYPE "OrganizationType" ADD VALUE IF NOT EXISTS 'HOSPITAL';
ALTER TYPE "OrganizationType" ADD VALUE IF NOT EXISTS 'UTILITY_COMPANY';
ALTER TYPE "OrganizationType" ADD VALUE IF NOT EXISTS 'PRIVATE_FACILITY';
ALTER TYPE "OrganizationType" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

ALTER TABLE "Organization"
ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "contactEmail" TEXT,
ADD COLUMN "contactPhone" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "lga" TEXT,
ADD COLUMN "country" TEXT DEFAULT 'Nigeria',
ADD COLUMN "profileData" JSONB;

CREATE INDEX "Organization_status_idx" ON "Organization"("status");

CREATE TABLE "ReportActivity" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorRole" "UserRole",
  "actorName" TEXT,
  "action" TEXT NOT NULL,
  "fromStatus" "ReportStatus",
  "toStatus" "ReportStatus",
  "providerId" TEXT,
  "reason" TEXT,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReportActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportActivity_reportId_createdAt_idx" ON "ReportActivity"("reportId", "createdAt");
CREATE INDEX "ReportActivity_organizationId_createdAt_idx" ON "ReportActivity"("organizationId", "createdAt");
CREATE INDEX "ReportActivity_actorUserId_createdAt_idx" ON "ReportActivity"("actorUserId", "createdAt");
CREATE INDEX "ReportActivity_action_idx" ON "ReportActivity"("action");

ALTER TABLE "ReportActivity"
ADD CONSTRAINT "ReportActivity_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
