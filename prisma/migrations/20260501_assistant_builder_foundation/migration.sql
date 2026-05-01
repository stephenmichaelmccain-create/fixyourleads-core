CREATE TYPE "AssistantBuildStatus" AS ENUM ('QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'FAILED', 'APPROVED', 'PUBLISHED');

CREATE TYPE "AssistantArtifactStatus" AS ENUM ('NEEDS_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED');

CREATE TYPE "AssistantMetricWindow" AS ENUM ('LIFETIME', 'LAST_7_DAYS', 'LAST_30_DAYS');

CREATE TABLE "GlobalAssistantSkillVersion" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Base Skill',
  "content" JSONB NOT NULL,
  "validationRules" JSONB NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GlobalAssistantSkillVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalAssistantSkillVersion_version_key" ON "GlobalAssistantSkillVersion"("version");
CREATE INDEX "GlobalAssistantSkillVersion_createdAt_idx" ON "GlobalAssistantSkillVersion"("createdAt");

CREATE TABLE "ClientAssistantOverrideVersion" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "overridePayload" JSONB NOT NULL,
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientAssistantOverrideVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientAssistantOverrideVersion_companyId_version_key" ON "ClientAssistantOverrideVersion"("companyId", "version");
CREATE INDEX "ClientAssistantOverrideVersion_companyId_createdAt_idx" ON "ClientAssistantOverrideVersion"("companyId", "createdAt");

CREATE TABLE "AssistantBuildRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "baseSkillVersionId" TEXT NOT NULL,
  "clientOverrideVersionId" TEXT,
  "status" "AssistantBuildStatus" NOT NULL DEFAULT 'QUEUED',
  "requestedBy" TEXT,
  "model" TEXT NOT NULL,
  "inputPayload" JSONB NOT NULL,
  "outputPayload" JSONB,
  "validationPayload" JSONB,
  "errorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "AssistantBuildRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantBuildRun_companyId_queuedAt_idx" ON "AssistantBuildRun"("companyId", "queuedAt");
CREATE INDEX "AssistantBuildRun_status_queuedAt_idx" ON "AssistantBuildRun"("status", "queuedAt");

CREATE TABLE "AssistantArtifactVersion" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "buildRunId" TEXT NOT NULL,
  "baseSkillVersionId" TEXT NOT NULL,
  "clientOverrideVersionId" TEXT,
  "version" INTEGER NOT NULL,
  "status" "AssistantArtifactStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "systemPrompt" TEXT NOT NULL,
  "callFlow" JSONB NOT NULL,
  "qualificationLogic" JSONB NOT NULL,
  "fallbackRules" JSONB NOT NULL,
  "postCallOutputSchema" JSONB NOT NULL,
  "testingChecklist" JSONB NOT NULL,
  "validationPayload" JSONB NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "publishedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantArtifactVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantArtifactVersion_companyId_version_key" ON "AssistantArtifactVersion"("companyId", "version");
CREATE INDEX "AssistantArtifactVersion_companyId_createdAt_idx" ON "AssistantArtifactVersion"("companyId", "createdAt");

CREATE TABLE "AssistantArtifactMetricSnapshot" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "artifactVersionId" TEXT NOT NULL,
  "window" "AssistantMetricWindow" NOT NULL DEFAULT 'LIFETIME',
  "bookingRate" DOUBLE PRECISION,
  "qualificationAccuracy" DOUBLE PRECISION,
  "escalationRate" DOUBLE PRECISION,
  "latencyPerceptionScore" DOUBLE PRECISION,
  "complianceFlags" INTEGER,
  "sampleSize" INTEGER,
  "notes" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantArtifactMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantArtifactMetricSnapshot_artifactVersionId_capturedAt_idx" ON "AssistantArtifactMetricSnapshot"("artifactVersionId", "capturedAt");
CREATE INDEX "AssistantArtifactMetricSnapshot_companyId_capturedAt_idx" ON "AssistantArtifactMetricSnapshot"("companyId", "capturedAt");

ALTER TABLE "ClientAssistantOverrideVersion"
ADD CONSTRAINT "ClientAssistantOverrideVersion_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantBuildRun"
ADD CONSTRAINT "AssistantBuildRun_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantBuildRun"
ADD CONSTRAINT "AssistantBuildRun_baseSkillVersionId_fkey"
FOREIGN KEY ("baseSkillVersionId") REFERENCES "GlobalAssistantSkillVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssistantBuildRun"
ADD CONSTRAINT "AssistantBuildRun_clientOverrideVersionId_fkey"
FOREIGN KEY ("clientOverrideVersionId") REFERENCES "ClientAssistantOverrideVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantArtifactVersion"
ADD CONSTRAINT "AssistantArtifactVersion_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantArtifactVersion"
ADD CONSTRAINT "AssistantArtifactVersion_buildRunId_fkey"
FOREIGN KEY ("buildRunId") REFERENCES "AssistantBuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantArtifactVersion"
ADD CONSTRAINT "AssistantArtifactVersion_baseSkillVersionId_fkey"
FOREIGN KEY ("baseSkillVersionId") REFERENCES "GlobalAssistantSkillVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssistantArtifactVersion"
ADD CONSTRAINT "AssistantArtifactVersion_clientOverrideVersionId_fkey"
FOREIGN KEY ("clientOverrideVersionId") REFERENCES "ClientAssistantOverrideVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantArtifactMetricSnapshot"
ADD CONSTRAINT "AssistantArtifactMetricSnapshot_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantArtifactMetricSnapshot"
ADD CONSTRAINT "AssistantArtifactMetricSnapshot_artifactVersionId_fkey"
FOREIGN KEY ("artifactVersionId") REFERENCES "AssistantArtifactVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
