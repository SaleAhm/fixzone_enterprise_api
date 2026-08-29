-- Internal delegated administration, scoped role assignments and privileged approval foundation.
-- Additive only: existing users, invitations, audit logs and payment records are preserved.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_SUPER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERATIONS_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ORGANIZATION_ONBOARDING_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROVIDER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FINANCE_BILLING_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ASSET_INTELLIGENCE_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SECURITY_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INVESTIGATION_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'COMPLIANCE_AUDIT_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RELEASE_OPERATIONS_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'BACKUP_RECOVERY_ADMIN';

CREATE TYPE "InternalRoleAssignmentStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'REVOKED',
  'EXPIRED',
  'PENDING_APPROVAL'
);

CREATE TYPE "InternalScopeType" AS ENUM (
  'PLATFORM',
  'MODULE',
  'ORGANIZATION',
  'JURISDICTION'
);

CREATE TYPE "PrivilegedApprovalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'EXECUTION_BLOCKED'
);

CREATE TYPE "PrivilegedOperationType" AS ENUM (
  'PLATFORM_SUPER_ADMIN_GRANT',
  'ROLE_DEFINITION_CHANGE',
  'PRODUCTION_RESTORE_AUTHORIZATION',
  'ENTERPRISE_FEATURE_ENABLEMENT',
  'PAYMENT_CONFIGURATION_CHANGE',
  'HIGH_VALUE_REFUND_APPROVAL'
);

CREATE TABLE "InternalRoleAssignment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "InternalRoleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "scopeType" "InternalScopeType" NOT NULL DEFAULT 'PLATFORM',
  "scopeRef" TEXT,
  "organizationId" TEXT,
  "moduleKey" TEXT,
  "jurisdiction" JSONB,
  "permissionsSnapshot" JSONB NOT NULL,
  "roleDefinitionVersion" INTEGER NOT NULL DEFAULT 1,
  "assignedById" TEXT NOT NULL,
  "reason" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InternalRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivilegedApprovalRequest" (
  "id" TEXT NOT NULL,
  "operationType" "PrivilegedOperationType" NOT NULL,
  "status" "PrivilegedApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requesterId" TEXT NOT NULL,
  "approverId" TEXT,
  "targetUserId" TEXT,
  "organizationId" TEXT,
  "requestedRole" "UserRole",
  "requestedScope" JSONB,
  "payload" JSONB,
  "reason" TEXT,
  "decisionReason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "executionBlocked" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrivilegedApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InternalRoleAssignment_userId_status_idx"
  ON "InternalRoleAssignment"("userId", "status");

CREATE INDEX "InternalRoleAssignment_role_status_idx"
  ON "InternalRoleAssignment"("role", "status");

CREATE INDEX "InternalRoleAssignment_scopeType_scopeRef_idx"
  ON "InternalRoleAssignment"("scopeType", "scopeRef");

CREATE INDEX "InternalRoleAssignment_organizationId_idx"
  ON "InternalRoleAssignment"("organizationId");

CREATE INDEX "InternalRoleAssignment_moduleKey_idx"
  ON "InternalRoleAssignment"("moduleKey");

CREATE INDEX "InternalRoleAssignment_assignedById_idx"
  ON "InternalRoleAssignment"("assignedById");

CREATE INDEX "InternalRoleAssignment_expiresAt_idx"
  ON "InternalRoleAssignment"("expiresAt");

CREATE INDEX "PrivilegedApprovalRequest_operationType_status_idx"
  ON "PrivilegedApprovalRequest"("operationType", "status");

CREATE INDEX "PrivilegedApprovalRequest_requesterId_requestedAt_idx"
  ON "PrivilegedApprovalRequest"("requesterId", "requestedAt");

CREATE INDEX "PrivilegedApprovalRequest_approverId_decidedAt_idx"
  ON "PrivilegedApprovalRequest"("approverId", "decidedAt");

CREATE INDEX "PrivilegedApprovalRequest_targetUserId_idx"
  ON "PrivilegedApprovalRequest"("targetUserId");

CREATE INDEX "PrivilegedApprovalRequest_organizationId_idx"
  ON "PrivilegedApprovalRequest"("organizationId");

ALTER TABLE "InternalRoleAssignment"
  ADD CONSTRAINT "InternalRoleAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InternalRoleAssignment"
  ADD CONSTRAINT "InternalRoleAssignment_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InternalRoleAssignment"
  ADD CONSTRAINT "InternalRoleAssignment_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PrivilegedApprovalRequest"
  ADD CONSTRAINT "PrivilegedApprovalRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrivilegedApprovalRequest"
  ADD CONSTRAINT "PrivilegedApprovalRequest_approverId_fkey"
  FOREIGN KEY ("approverId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
