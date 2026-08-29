ALTER TABLE "Report"
ADD COLUMN "locationReceivedAt" TIMESTAMP(3),
ADD COLUMN "locationPermissionState" TEXT,
ADD COLUMN "locationValidationOutcome" TEXT,
ADD COLUMN "locationSchemaVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "EvidenceRecord"
ADD COLUMN "geoLatitude" DOUBLE PRECISION,
ADD COLUMN "geoLongitude" DOUBLE PRECISION,
ADD COLUMN "geoAccuracyMeters" DOUBLE PRECISION,
ADD COLUMN "geoCapturedAt" TIMESTAMP(3),
ADD COLUMN "geoReceivedAt" TIMESTAMP(3),
ADD COLUMN "geoSource" TEXT,
ADD COLUMN "geoCaptureMethod" TEXT,
ADD COLUMN "geoPermissionState" TEXT,
ADD COLUMN "geoValidationOutcome" TEXT,
ADD COLUMN "geoDistanceMeters" DOUBLE PRECISION,
ADD COLUMN "geoTrustOutcome" TEXT,
ADD COLUMN "geoSchemaVersion" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "EvidenceRecord_geoLatitude_geoLongitude_idx" ON "EvidenceRecord"("geoLatitude", "geoLongitude");
CREATE INDEX "EvidenceRecord_geoTrustOutcome_idx" ON "EvidenceRecord"("geoTrustOutcome");
