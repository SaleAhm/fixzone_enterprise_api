ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PENDING_PROVIDER';

ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'PENDING_INVITE';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'DEACTIVATED';

CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "temporaryPasswordHash" TEXT,
    "inviteCode" TEXT NOT NULL,
    "organizationId" TEXT,
    "invitedById" TEXT NOT NULL,
    "acceptedUserId" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invitation_inviteCode_key" ON "Invitation"("inviteCode");
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");
CREATE INDEX "Invitation_invitedById_idx" ON "Invitation"("invitedById");
CREATE INDEX "Invitation_status_idx" ON "Invitation"("status");
CREATE INDEX "Invitation_role_idx" ON "Invitation"("role");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");
CREATE INDEX "Invitation_phone_idx" ON "Invitation"("phone");
CREATE INDEX "Invitation_createdAt_idx" ON "Invitation"("createdAt");

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
