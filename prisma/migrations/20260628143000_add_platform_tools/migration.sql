CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "PlatformBackup" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "createdById" TEXT NOT NULL,
    "restoredAt" TIMESTAMP(3),
    "restoredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformBackup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformBackup_fileName_key" ON "PlatformBackup"("fileName");
CREATE INDEX "PlatformBackup_createdAt_idx" ON "PlatformBackup"("createdAt");
CREATE INDEX "PlatformBackup_createdById_idx" ON "PlatformBackup"("createdById");
CREATE INDEX "PlatformBackup_status_idx" ON "PlatformBackup"("status");
