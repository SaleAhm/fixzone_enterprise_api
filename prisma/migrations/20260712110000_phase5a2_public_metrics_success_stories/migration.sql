CREATE TABLE "PublicSuccessStory" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "broadLocation" TEXT NOT NULL,
    "organizationName" TEXT,
    "outcome" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "approvedForPublic" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publicImage" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicSuccessStory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicSuccessStory_approvedForPublic_displayOrder_idx" ON "PublicSuccessStory"("approvedForPublic", "displayOrder");
CREATE INDEX "PublicSuccessStory_approvedAt_idx" ON "PublicSuccessStory"("approvedAt");
CREATE INDEX "PublicSuccessStory_category_idx" ON "PublicSuccessStory"("category");
