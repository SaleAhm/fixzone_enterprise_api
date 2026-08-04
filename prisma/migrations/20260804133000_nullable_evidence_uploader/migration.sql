ALTER TABLE "EvidenceRecord"
ALTER COLUMN "uploadedById" DROP NOT NULL;

ALTER TABLE "EvidenceRecord"
DROP CONSTRAINT IF EXISTS "EvidenceRecord_uploadedById_fkey";

ALTER TABLE "EvidenceRecord"
ADD CONSTRAINT "EvidenceRecord_uploadedById_fkey"
FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
