CREATE TYPE "OrganizationType" AS ENUM ('FEDERAL', 'STATE', 'LOCAL_GOVERNMENT', 'AGENCY', 'CORPORATE', 'ESTATE', 'CAMPUS', 'COMMUNITY');
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'DEMO', 'STARTER', 'PROFESSIONAL', 'GOVERNMENT', 'ENTERPRISE');
CREATE TYPE "BillingStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "ProviderEngagementType" AS ENUM ('INTERNAL_STAFF', 'EXTERNAL_CONTRACTOR');

ALTER TABLE "Organization"
ADD COLUMN "type" "OrganizationType" NOT NULL DEFAULT 'LOCAL_GOVERNMENT',
ADD COLUMN "parentId" TEXT,
ADD COLUMN "tenantCode" TEXT,
ADD COLUMN "subscriptionPlan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
ADD COLUMN "billingStatus" "BillingStatus" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN "subscriptionStartAt" TIMESTAMP(3),
ADD COLUMN "subscriptionEndAt" TIMESTAMP(3),
ADD COLUMN "allowedUsers" INTEGER,
ADD COLUMN "allowedProviders" INTEGER,
ADD COLUMN "allowedReportsPerMonth" INTEGER,
ADD COLUMN "allowedStorageMb" INTEGER,
ADD COLUMN "enabledModules" JSONB;

ALTER TABLE "User"
ADD COLUMN "providerEngagementType" "ProviderEngagementType",
ADD COLUMN "serviceZones" JSONB;

CREATE TABLE "ProviderOrganization" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "serviceZones" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderOrganization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderOrganization_providerId_organizationId_key" ON "ProviderOrganization"("providerId", "organizationId");
CREATE INDEX "ProviderOrganization_organizationId_active_idx" ON "ProviderOrganization"("organizationId", "active");
CREATE INDEX "ProviderOrganization_providerId_active_idx" ON "ProviderOrganization"("providerId", "active");
CREATE INDEX "Organization_parentId_idx" ON "Organization"("parentId");
CREATE INDEX "Organization_type_idx" ON "Organization"("type");
CREATE INDEX "Organization_subscriptionPlan_idx" ON "Organization"("subscriptionPlan");
CREATE INDEX "Organization_billingStatus_idx" ON "Organization"("billingStatus");

ALTER TABLE "Organization"
ADD CONSTRAINT "Organization_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProviderOrganization"
ADD CONSTRAINT "ProviderOrganization_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderOrganization"
ADD CONSTRAINT "ProviderOrganization_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
