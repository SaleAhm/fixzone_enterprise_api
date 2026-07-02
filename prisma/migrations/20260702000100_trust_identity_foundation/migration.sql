-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('UNVERIFIED', 'PHONE_VERIFIED', 'EMAIL_VERIFIED', 'ID_PENDING', 'ID_VERIFIED', 'FACE_PENDING', 'FACE_VERIFIED', 'ADDRESS_PENDING', 'ADDRESS_VERIFIED', 'BUSINESS_VERIFIED', 'ENTERPRISE_VERIFIED');

-- CreateEnum
CREATE TYPE "IdentityType" AS ENUM ('INDIVIDUAL', 'PROVIDER_INDIVIDUAL', 'BUSINESS', 'ORGANIZATION_REPRESENTATIVE', 'GOVERNMENT_REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "KycSubmissionType" AS ENUM ('GOVERNMENT_ID', 'FACE_SELFIE', 'ADDRESS_PROOF', 'BUSINESS_DOCUMENT', 'PROFESSIONAL_LICENSE');

-- CreateEnum
CREATE TYPE "KycSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EvidenceRelatedEntityType" AS ENUM ('REPORT', 'KYC_SUBMISSION', 'PROVIDER', 'ORGANIZATION', 'SERVICE_REQUEST', 'DISPUTE', 'USER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'AWAITING_CLIENT_RESPONSE', 'AWAITING_PROVIDER_RESPONSE', 'RESOLVED', 'REJECTED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisputePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "PlatformEntitlementPlan" AS ENUM ('FREE', 'VERIFIED', 'PERSONAL_PLUS', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE', 'GOVERNMENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "addressVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "businessVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "enterpriseVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "faceVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "idVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "identityType" "IdentityType" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "identityVerificationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "identityVerificationStatus" "IdentityVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "secureZoneId" TEXT,
ADD COLUMN     "trustScore" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "KycSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submissionType" "KycSubmissionType" NOT NULL,
    "status" "KycSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "documentUrl" TEXT,
    "evidenceFileRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "organizationId" TEXT,
    "relatedEntityType" "EvidenceRelatedEntityType" NOT NULL,
    "relatedEntityId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "metadata" JSONB,
    "checksum" TEXT,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeCase" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "againstUserId" TEXT,
    "organizationId" TEXT,
    "relatedEntityType" TEXT NOT NULL,
    "relatedEntityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "DisputePriority" NOT NULL DEFAULT 'MEDIUM',
    "resolutionSummary" TEXT,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "DisputeCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeMessage" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "PlatformEntitlementPlan" NOT NULL DEFAULT 'FREE',
    "canAccessServiceModule" BOOLEAN NOT NULL DEFAULT true,
    "canUsePremiumProvider" BOOLEAN NOT NULL DEFAULT false,
    "canOpenDispute" BOOLEAN NOT NULL DEFAULT true,
    "canUploadEvidence" BOOLEAN NOT NULL DEFAULT true,
    "canUsePrioritySupport" BOOLEAN NOT NULL DEFAULT false,
    "requiredVerificationLevel" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "UserRole",
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycSubmission_userId_status_idx" ON "KycSubmission"("userId", "status");

-- CreateIndex
CREATE INDEX "KycSubmission_submissionType_idx" ON "KycSubmission"("submissionType");

-- CreateIndex
CREATE INDEX "KycSubmission_status_idx" ON "KycSubmission"("status");

-- CreateIndex
CREATE INDEX "KycSubmission_reviewedById_idx" ON "KycSubmission"("reviewedById");

-- CreateIndex
CREATE INDEX "KycSubmission_submittedAt_idx" ON "KycSubmission"("submittedAt");

-- CreateIndex
CREATE INDEX "LoginHistory_userId_loginAt_idx" ON "LoginHistory"("userId", "loginAt");

-- CreateIndex
CREATE INDEX "LoginHistory_email_idx" ON "LoginHistory"("email");

-- CreateIndex
CREATE INDEX "LoginHistory_success_idx" ON "LoginHistory"("success");

-- CreateIndex
CREATE INDEX "LoginHistory_loginAt_idx" ON "LoginHistory"("loginAt");

-- CreateIndex
CREATE INDEX "EvidenceRecord_ownerUserId_uploadedAt_idx" ON "EvidenceRecord"("ownerUserId", "uploadedAt");

-- CreateIndex
CREATE INDEX "EvidenceRecord_organizationId_uploadedAt_idx" ON "EvidenceRecord"("organizationId", "uploadedAt");

-- CreateIndex
CREATE INDEX "EvidenceRecord_relatedEntityType_relatedEntityId_idx" ON "EvidenceRecord"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_uploadedById_idx" ON "EvidenceRecord"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeCase_caseNumber_key" ON "DisputeCase"("caseNumber");

-- CreateIndex
CREATE INDEX "DisputeCase_openedById_createdAt_idx" ON "DisputeCase"("openedById", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeCase_againstUserId_idx" ON "DisputeCase"("againstUserId");

-- CreateIndex
CREATE INDEX "DisputeCase_organizationId_createdAt_idx" ON "DisputeCase"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeCase_status_idx" ON "DisputeCase"("status");

-- CreateIndex
CREATE INDEX "DisputeCase_relatedEntityType_relatedEntityId_idx" ON "DisputeCase"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "DisputeMessage_disputeId_createdAt_idx" ON "DisputeMessage"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeMessage_authorId_idx" ON "DisputeMessage"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "UserEntitlement_userId_key" ON "UserEntitlement"("userId");

-- CreateIndex
CREATE INDEX "UserEntitlement_plan_idx" ON "UserEntitlement"("plan");

-- CreateIndex
CREATE INDEX "ComplianceAuditLog_actorId_createdAt_idx" ON "ComplianceAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceAuditLog_organizationId_createdAt_idx" ON "ComplianceAuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceAuditLog_action_idx" ON "ComplianceAuditLog"("action");

-- CreateIndex
CREATE INDEX "ComplianceAuditLog_entityType_entityId_idx" ON "ComplianceAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ComplianceAuditLog_createdAt_idx" ON "ComplianceAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_secureZoneId_key" ON "User"("secureZoneId");

-- CreateIndex
CREATE INDEX "User_secureZoneId_idx" ON "User"("secureZoneId");

-- CreateIndex
CREATE INDEX "User_identityVerificationStatus_idx" ON "User"("identityVerificationStatus");

-- CreateIndex
CREATE INDEX "User_identityType_idx" ON "User"("identityType");

-- AddForeignKey
ALTER TABLE "KycSubmission" ADD CONSTRAINT "KycSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycSubmission" ADD CONSTRAINT "KycSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_againstUserId_fkey" FOREIGN KEY ("againstUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEntitlement" ADD CONSTRAINT "UserEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAuditLog" ADD CONSTRAINT "ComplianceAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAuditLog" ADD CONSTRAINT "ComplianceAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
