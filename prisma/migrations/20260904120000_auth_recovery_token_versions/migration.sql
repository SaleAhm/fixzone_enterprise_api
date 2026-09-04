-- Secure password recovery and token-version session revocation foundation.
ALTER TABLE "User"
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "requestedById" TEXT,
  "deliveryStatus" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenDigest_key"
  ON "PasswordResetToken"("tokenDigest");

CREATE INDEX "PasswordResetToken_userId_createdAt_idx"
  ON "PasswordResetToken"("userId", "createdAt");

CREATE INDEX "PasswordResetToken_userId_usedAt_supersededAt_expiresAt_idx"
  ON "PasswordResetToken"("userId", "usedAt", "supersededAt", "expiresAt");

CREATE INDEX "PasswordResetToken_expiresAt_idx"
  ON "PasswordResetToken"("expiresAt");

CREATE INDEX "User_tokenVersion_idx"
  ON "User"("tokenVersion");

ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
