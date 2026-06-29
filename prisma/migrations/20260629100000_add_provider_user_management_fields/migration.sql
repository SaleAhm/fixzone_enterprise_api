CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "User"
ADD COLUMN "providerId" TEXT,
ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "serviceCategories" JSONB,
ADD COLUMN "coverageAreas" JSONB,
ADD COLUMN "profileData" JSONB,
ADD COLUMN "subscriptionPlan" "SubscriptionPlan";

CREATE UNIQUE INDEX "User_providerId_key" ON "User"("providerId");
CREATE INDEX "User_accountStatus_idx" ON "User"("accountStatus");
