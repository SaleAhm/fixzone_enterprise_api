CREATE TYPE "PrivilegedMfaEnrollmentStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'DISABLED'
);

CREATE TYPE "PrivilegedMfaPreAuthPurpose" AS ENUM (
  'ENROLLMENT',
  'CHALLENGE'
);

CREATE TABLE "PrivilegedMfaEnrollment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "PrivilegedMfaEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
  "encryptedTotpSecret" TEXT NOT NULL,
  "secretFormatVersion" INTEGER NOT NULL DEFAULT 1,
  "enabledAt" TIMESTAMP(3),
  "enforcedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "lastVerifiedStep" BIGINT,
  "recoveryResetAt" TIMESTAMP(3),
  "recoveryResetById" TEXT,
  "disabledAt" TIMESTAMP(3),
  "disabledById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PrivilegedMfaEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivilegedMfaBackupCode" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeDigest" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PrivilegedMfaBackupCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivilegedMfaPreAuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "purpose" "PrivilegedMfaPreAuthPurpose" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PrivilegedMfaPreAuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivilegedMfaBackupCode_codeDigest_key"
  ON "PrivilegedMfaBackupCode"("codeDigest");

CREATE UNIQUE INDEX "PrivilegedMfaPreAuthSession_tokenDigest_key"
  ON "PrivilegedMfaPreAuthSession"("tokenDigest");

CREATE INDEX "PrivilegedMfaEnrollment_userId_status_idx"
  ON "PrivilegedMfaEnrollment"("userId", "status");

CREATE INDEX "PrivilegedMfaEnrollment_enabledAt_idx"
  ON "PrivilegedMfaEnrollment"("enabledAt");

CREATE INDEX "PrivilegedMfaEnrollment_lastVerifiedAt_idx"
  ON "PrivilegedMfaEnrollment"("lastVerifiedAt");

CREATE INDEX "PrivilegedMfaBackupCode_enrollmentId_usedAt_idx"
  ON "PrivilegedMfaBackupCode"("enrollmentId", "usedAt");

CREATE INDEX "PrivilegedMfaBackupCode_userId_usedAt_idx"
  ON "PrivilegedMfaBackupCode"("userId", "usedAt");

CREATE INDEX "PrivilegedMfaPreAuthSession_userId_purpose_expiresAt_idx"
  ON "PrivilegedMfaPreAuthSession"("userId", "purpose", "expiresAt");

CREATE INDEX "PrivilegedMfaPreAuthSession_expiresAt_idx"
  ON "PrivilegedMfaPreAuthSession"("expiresAt");

CREATE INDEX "PrivilegedMfaPreAuthSession_consumedAt_idx"
  ON "PrivilegedMfaPreAuthSession"("consumedAt");

CREATE INDEX "PrivilegedMfaPreAuthSession_lockedAt_idx"
  ON "PrivilegedMfaPreAuthSession"("lockedAt");

ALTER TABLE "PrivilegedMfaEnrollment"
  ADD CONSTRAINT "PrivilegedMfaEnrollment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrivilegedMfaBackupCode"
  ADD CONSTRAINT "PrivilegedMfaBackupCode_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "PrivilegedMfaEnrollment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrivilegedMfaPreAuthSession"
  ADD CONSTRAINT "PrivilegedMfaPreAuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
