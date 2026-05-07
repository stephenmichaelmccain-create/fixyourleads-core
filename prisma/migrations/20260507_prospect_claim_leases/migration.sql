ALTER TABLE "Prospect"
  ADD COLUMN IF NOT EXISTS "claimSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Prospect_claimExpiresAt_idx"
  ON "Prospect"("claimExpiresAt");

CREATE INDEX IF NOT EXISTS "Prospect_claimSessionId_claimExpiresAt_idx"
  ON "Prospect"("claimSessionId", "claimExpiresAt");
