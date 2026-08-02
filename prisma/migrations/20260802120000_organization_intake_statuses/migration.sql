-- Add explicit report intake states for organization-first routing.
ALTER TYPE "ReportStatus" ADD VALUE IF NOT EXISTS 'TRIAGE';
ALTER TYPE "ReportStatus" ADD VALUE IF NOT EXISTS 'ORG_REVIEW';
