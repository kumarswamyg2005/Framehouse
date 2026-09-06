-- Generalises PinAttempt into AccessAttempt so the same throttle covers sign-in
-- as well as the gallery PIN.
--
-- The table holds transient rate-limit state only — nothing here is a record of
-- anything a user would miss — so it is replaced rather than migrated. The
-- practical effect is that any in-flight lockouts reset once at deploy.

-- CreateEnum
CREATE TYPE "AttemptKind" AS ENUM ('GALLERY_PIN', 'LOGIN');

-- DropTable
DROP TABLE "PinAttempt";

-- CreateTable
CREATE TABLE "AccessAttempt" (
    "id" TEXT NOT NULL,
    "kind" "AttemptKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded" BOOLEAN NOT NULL,

    CONSTRAINT "AccessAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessAttempt_kind_subject_ipHash_attemptedAt_idx" ON "AccessAttempt"("kind", "subject", "ipHash", "attemptedAt");

-- Supports pruning old rows without a full scan.
CREATE INDEX "AccessAttempt_attemptedAt_idx" ON "AccessAttempt"("attemptedAt");
