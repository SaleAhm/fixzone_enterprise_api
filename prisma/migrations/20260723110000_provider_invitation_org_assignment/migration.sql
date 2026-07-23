-- Provider Invitation, Organization Activation & Assignment Completion
-- Additive only: preserves existing report tenant ownership and provider assignments.

ALTER TABLE "Report"
ADD COLUMN "assignedOrganizationId" TEXT,
ADD COLUMN "organizationAssignedById" TEXT,
ADD COLUMN "organizationAssignedAt" TIMESTAMP(3),
ADD COLUMN "organizationAssignmentSource" TEXT;

CREATE INDEX "Report_assignedOrganizationId_idx" ON "Report"("assignedOrganizationId");

ALTER TABLE "Report"
ADD CONSTRAINT "Report_assignedOrganizationId_fkey"
FOREIGN KEY ("assignedOrganizationId") REFERENCES "Organization"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Invitation_organizationId_status_idx" ON "Invitation"("organizationId", "status");
CREATE INDEX "Invitation_email_organizationId_status_idx" ON "Invitation"("email", "organizationId", "status");
CREATE INDEX "Invitation_phone_organizationId_status_idx" ON "Invitation"("phone", "organizationId", "status");
