ALTER TABLE "Report"
ADD COLUMN "locationAccuracy" DOUBLE PRECISION,
ADD COLUMN "locationCapturedAt" TIMESTAMP(3),
ADD COLUMN "locationSource" TEXT,
ADD COLUMN "completionLatitude" DOUBLE PRECISION,
ADD COLUMN "completionLongitude" DOUBLE PRECISION,
ADD COLUMN "completionAccuracy" DOUBLE PRECISION,
ADD COLUMN "completionLocationCapturedAt" TIMESTAMP(3),
ADD COLUMN "completionLocationSource" TEXT;
