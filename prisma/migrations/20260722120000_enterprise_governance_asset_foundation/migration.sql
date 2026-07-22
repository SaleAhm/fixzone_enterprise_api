-- Phase Enterprise Governance & Asset Intelligence Foundation
-- Additive-only migration: no destructive changes, no production data mutation.

CREATE TYPE "AdminScopeType" AS ENUM ('PLATFORM', 'ORGANIZATION', 'JURISDICTION', 'MODULE', 'ASSET', 'REPORT');
CREATE TYPE "DelegatedAuthorityStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');
CREATE TYPE "RegulatoryCaseStatus" AS ENUM ('DRAFT', 'OPEN', 'UNDER_REVIEW', 'READY_FOR_EXPORT', 'EXPORTED', 'CLOSED');
CREATE TYPE "RegulatoryExportStatus" AS ENUM ('REQUESTED', 'PREPARING', 'READY', 'FAILED', 'CANCELLED');
CREATE TYPE "EvidencePackageStatus" AS ENUM ('DRAFT', 'SEALED', 'EXPORTED', 'VOIDED');
CREATE TYPE "EvidenceAuditAction" AS ENUM ('UPLOADED', 'VIEWED', 'DOWNLOADED', 'EXPORTED', 'METADATA_UPDATED', 'SOFT_DELETED', 'RESTORED');
CREATE TYPE "OwnershipStatus" AS ENUM ('UNKNOWN', 'PENDING', 'VERIFIED', 'DISPUTED');
CREATE TYPE "OwnerType" AS ENUM ('FEDERAL', 'STATE', 'LGA', 'PRIVATE', 'NGO', 'COMMUNITY', 'ENTERPRISE');
CREATE TYPE "AssetClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'DISPUTED', 'CANCELLED');

ALTER TYPE "UserRole" ADD VALUE 'PLATFORM_OWNER';
ALTER TYPE "UserRole" ADD VALUE 'EXECUTIVE_SUPER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'TECHNICAL_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'BILLING_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'LEGAL_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'ASSIGNMENT_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'ASSET_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'COMPLIANCE_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'REGULATORY_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'SUPPORT_ADMIN';
ALTER TYPE "InvitationStatus" ADD VALUE 'CANCELLED';

CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permissionId" TEXT NOT NULL,
    "inheritedFrom" "UserRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeType" "AdminScopeType" NOT NULL,
    "scopeRef" TEXT,
    "organizationId" TEXT,
    "permissions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminScope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DelegatedAuthority" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delegatedById" TEXT NOT NULL,
    "organizationId" TEXT,
    "role" "UserRole" NOT NULL,
    "permissions" JSONB,
    "scopes" JSONB,
    "status" "DelegatedAuthorityStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DelegatedAuthority_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RegulatoryCase" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "organizationId" TEXT,
    "reportId" TEXT,
    "disputeId" TEXT,
    "title" TEXT NOT NULL,
    "status" "RegulatoryCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegulatoryCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RegulatoryExport" (
    "id" TEXT NOT NULL,
    "regulatoryCaseId" TEXT,
    "organizationId" TEXT,
    "exportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" "RegulatoryExportStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "fileUrl" TEXT,
    "checksum" TEXT,
    "metadata" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "RegulatoryExport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidencePackage" (
    "id" TEXT NOT NULL,
    "regulatoryCaseId" TEXT,
    "organizationId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "status" "EvidencePackageStatus" NOT NULL DEFAULT 'DRAFT',
    "manifest" JSONB,
    "checksum" TEXT,
    "createdById" TEXT,
    "sealedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EvidencePackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisputeTimeline" (
    "id" TEXT NOT NULL,
    "disputeCaseId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeTimeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeCaseId" TEXT NOT NULL,
    "evidenceRecordId" TEXT,
    "uploadedById" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisputeDecision" (
    "id" TEXT NOT NULL,
    "disputeCaseId" TEXT NOT NULL,
    "decidedById" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceAudit" (
    "id" TEXT NOT NULL,
    "evidenceRecordId" TEXT,
    "actorId" TEXT,
    "actorRole" "UserRole",
    "action" "EvidenceAuditAction" NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceAccessLog" (
    "id" TEXT NOT NULL,
    "evidenceRecordId" TEXT,
    "actorId" TEXT,
    "actorRole" "UserRole",
    "action" "EvidenceAuditAction" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JurisdictionZone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "zoneType" TEXT NOT NULL,
    "state" TEXT,
    "lga" TEXT,
    "country" TEXT DEFAULT 'Nigeria',
    "boundaryRef" TEXT,
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JurisdictionZone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetCluster" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "category" TEXT,
    "locationText" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusKm" DOUBLE PRECISION,
    "incidentCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetCluster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PotentialAsset" (
    "id" TEXT NOT NULL,
    "assetClusterId" TEXT,
    "organizationId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "locationText" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "ownershipStatus" "OwnershipStatus" NOT NULL DEFAULT 'UNKNOWN',
    "ownerType" "OwnerType",
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PotentialAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetCandidateOwner" (
    "id" TEXT NOT NULL,
    "potentialAssetId" TEXT,
    "organizationId" TEXT,
    "ownerName" TEXT NOT NULL,
    "ownerType" "OwnerType" NOT NULL,
    "ownershipStatus" "OwnershipStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "source" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetCandidateOwner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnershipRecommendation" (
    "id" TEXT NOT NULL,
    "potentialAssetId" TEXT,
    "reportId" TEXT,
    "recommendedOwnerType" "OwnerType",
    "recommendedOwnerName" TEXT,
    "status" "OwnershipStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OwnershipRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetClaim" (
    "id" TEXT NOT NULL,
    "potentialAssetId" TEXT,
    "claimantUserId" TEXT,
    "claimantOrganizationId" TEXT,
    "ownerType" "OwnerType",
    "status" "AssetClaimStatus" NOT NULL DEFAULT 'PENDING',
    "claimNote" TEXT,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetOwnershipHistory" (
    "id" TEXT NOT NULL,
    "potentialAssetId" TEXT,
    "previousOwnerType" "OwnerType",
    "previousOwnerName" TEXT,
    "newOwnerType" "OwnerType",
    "newOwnerName" TEXT,
    "status" "OwnershipStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetOwnershipHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");
CREATE INDEX "Permission_module_idx" ON "Permission"("module");
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE UNIQUE INDEX "RolePermission_role_permissionId_key" ON "RolePermission"("role", "permissionId");
CREATE INDEX "AdminScope_userId_active_idx" ON "AdminScope"("userId", "active");
CREATE INDEX "AdminScope_scopeType_scopeRef_idx" ON "AdminScope"("scopeType", "scopeRef");
CREATE INDEX "AdminScope_organizationId_idx" ON "AdminScope"("organizationId");
CREATE INDEX "DelegatedAuthority_userId_status_idx" ON "DelegatedAuthority"("userId", "status");
CREATE INDEX "DelegatedAuthority_delegatedById_idx" ON "DelegatedAuthority"("delegatedById");
CREATE INDEX "DelegatedAuthority_organizationId_idx" ON "DelegatedAuthority"("organizationId");
CREATE INDEX "DelegatedAuthority_role_idx" ON "DelegatedAuthority"("role");
CREATE UNIQUE INDEX "RegulatoryCase_caseNumber_key" ON "RegulatoryCase"("caseNumber");
CREATE INDEX "RegulatoryCase_organizationId_createdAt_idx" ON "RegulatoryCase"("organizationId", "createdAt");
CREATE INDEX "RegulatoryCase_reportId_idx" ON "RegulatoryCase"("reportId");
CREATE INDEX "RegulatoryCase_disputeId_idx" ON "RegulatoryCase"("disputeId");
CREATE INDEX "RegulatoryCase_status_idx" ON "RegulatoryCase"("status");
CREATE INDEX "RegulatoryExport_regulatoryCaseId_idx" ON "RegulatoryExport"("regulatoryCaseId");
CREATE INDEX "RegulatoryExport_organizationId_requestedAt_idx" ON "RegulatoryExport"("organizationId", "requestedAt");
CREATE INDEX "RegulatoryExport_status_idx" ON "RegulatoryExport"("status");
CREATE INDEX "RegulatoryExport_requestedById_idx" ON "RegulatoryExport"("requestedById");
CREATE INDEX "EvidencePackage_regulatoryCaseId_idx" ON "EvidencePackage"("regulatoryCaseId");
CREATE INDEX "EvidencePackage_organizationId_createdAt_idx" ON "EvidencePackage"("organizationId", "createdAt");
CREATE INDEX "EvidencePackage_relatedEntityType_relatedEntityId_idx" ON "EvidencePackage"("relatedEntityType", "relatedEntityId");
CREATE INDEX "EvidencePackage_status_idx" ON "EvidencePackage"("status");
CREATE INDEX "DisputeTimeline_disputeCaseId_createdAt_idx" ON "DisputeTimeline"("disputeCaseId", "createdAt");
CREATE INDEX "DisputeTimeline_actorId_createdAt_idx" ON "DisputeTimeline"("actorId", "createdAt");
CREATE INDEX "DisputeTimeline_action_idx" ON "DisputeTimeline"("action");
CREATE INDEX "DisputeEvidence_disputeCaseId_createdAt_idx" ON "DisputeEvidence"("disputeCaseId", "createdAt");
CREATE INDEX "DisputeEvidence_evidenceRecordId_idx" ON "DisputeEvidence"("evidenceRecordId");
CREATE INDEX "DisputeEvidence_uploadedById_idx" ON "DisputeEvidence"("uploadedById");
CREATE INDEX "DisputeDecision_disputeCaseId_createdAt_idx" ON "DisputeDecision"("disputeCaseId", "createdAt");
CREATE INDEX "DisputeDecision_decidedById_idx" ON "DisputeDecision"("decidedById");
CREATE INDEX "EvidenceAudit_evidenceRecordId_createdAt_idx" ON "EvidenceAudit"("evidenceRecordId", "createdAt");
CREATE INDEX "EvidenceAudit_actorId_createdAt_idx" ON "EvidenceAudit"("actorId", "createdAt");
CREATE INDEX "EvidenceAudit_action_idx" ON "EvidenceAudit"("action");
CREATE INDEX "EvidenceAccessLog_evidenceRecordId_createdAt_idx" ON "EvidenceAccessLog"("evidenceRecordId", "createdAt");
CREATE INDEX "EvidenceAccessLog_actorId_createdAt_idx" ON "EvidenceAccessLog"("actorId", "createdAt");
CREATE INDEX "EvidenceAccessLog_action_idx" ON "EvidenceAccessLog"("action");
CREATE INDEX "JurisdictionZone_organizationId_active_idx" ON "JurisdictionZone"("organizationId", "active");
CREATE INDEX "JurisdictionZone_state_lga_idx" ON "JurisdictionZone"("state", "lga");
CREATE INDEX "JurisdictionZone_zoneType_idx" ON "JurisdictionZone"("zoneType");
CREATE INDEX "AssetCluster_organizationId_createdAt_idx" ON "AssetCluster"("organizationId", "createdAt");
CREATE INDEX "AssetCluster_category_idx" ON "AssetCluster"("category");
CREATE INDEX "AssetCluster_latitude_longitude_idx" ON "AssetCluster"("latitude", "longitude");
CREATE INDEX "PotentialAsset_assetClusterId_idx" ON "PotentialAsset"("assetClusterId");
CREATE INDEX "PotentialAsset_organizationId_createdAt_idx" ON "PotentialAsset"("organizationId", "createdAt");
CREATE INDEX "PotentialAsset_ownershipStatus_idx" ON "PotentialAsset"("ownershipStatus");
CREATE INDEX "PotentialAsset_ownerType_idx" ON "PotentialAsset"("ownerType");
CREATE INDEX "AssetCandidateOwner_potentialAssetId_idx" ON "AssetCandidateOwner"("potentialAssetId");
CREATE INDEX "AssetCandidateOwner_organizationId_idx" ON "AssetCandidateOwner"("organizationId");
CREATE INDEX "AssetCandidateOwner_ownerType_ownershipStatus_idx" ON "AssetCandidateOwner"("ownerType", "ownershipStatus");
CREATE INDEX "OwnershipRecommendation_potentialAssetId_idx" ON "OwnershipRecommendation"("potentialAssetId");
CREATE INDEX "OwnershipRecommendation_reportId_idx" ON "OwnershipRecommendation"("reportId");
CREATE INDEX "OwnershipRecommendation_status_idx" ON "OwnershipRecommendation"("status");
CREATE INDEX "AssetClaim_potentialAssetId_status_idx" ON "AssetClaim"("potentialAssetId", "status");
CREATE INDEX "AssetClaim_claimantUserId_idx" ON "AssetClaim"("claimantUserId");
CREATE INDEX "AssetClaim_claimantOrganizationId_idx" ON "AssetClaim"("claimantOrganizationId");
CREATE INDEX "AssetClaim_reviewedById_idx" ON "AssetClaim"("reviewedById");
CREATE INDEX "AssetOwnershipHistory_potentialAssetId_createdAt_idx" ON "AssetOwnershipHistory"("potentialAssetId", "createdAt");
CREATE INDEX "AssetOwnershipHistory_changedById_idx" ON "AssetOwnershipHistory"("changedById");
CREATE INDEX "AssetOwnershipHistory_status_idx" ON "AssetOwnershipHistory"("status");

ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
