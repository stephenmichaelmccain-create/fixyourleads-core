CREATE TYPE "CrmProvider" AS ENUM ('NONE', 'HUBSPOT', 'PIPEDRIVE', 'GOHIGHLEVEL', 'SALESFORCE', 'BOULEVARD', 'VAGARO');

CREATE TYPE "CrmSyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

ALTER TABLE "Company"
ADD COLUMN "notificationPhone" TEXT,
ADD COLUMN "telnyxAssistantId" TEXT,
ADD COLUMN "crmProvider" "CrmProvider" NOT NULL DEFAULT 'NONE',
ADD COLUMN "crmCredentialsEncrypted" TEXT,
ADD COLUMN "crmFieldMapping" JSONB;

CREATE UNIQUE INDEX "Company_telnyxAssistantId_key" ON "Company"("telnyxAssistantId");

CREATE TABLE "CrmSyncLog" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "leadId" TEXT,
  "contactId" TEXT,
  "provider" "CrmProvider" NOT NULL,
  "status" "CrmSyncStatus" NOT NULL,
  "externalId" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "response" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CrmSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmSyncLog_companyId_createdAt_idx" ON "CrmSyncLog"("companyId", "createdAt");
CREATE INDEX "CrmSyncLog_status_createdAt_idx" ON "CrmSyncLog"("status", "createdAt");
CREATE INDEX "CrmSyncLog_leadId_idx" ON "CrmSyncLog"("leadId");

ALTER TABLE "CrmSyncLog"
ADD CONSTRAINT "CrmSyncLog_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
