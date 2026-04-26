CREATE TYPE "AppointmentExternalSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED');

ALTER TABLE "Appointment"
ADD COLUMN     "externalCalendarEventId" TEXT,
ADD COLUMN     "externalCalendarProvider" TEXT,
ADD COLUMN     "externalSyncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "externalSyncError" TEXT,
ADD COLUMN     "externalSyncStatus" "AppointmentExternalSyncStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "externalSyncedAt" TIMESTAMP(3);

CREATE TABLE "UnroutedTelnyxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "eventId" TEXT,
    "messageId" TEXT,
    "inboundNumber" TEXT,
    "fromNumber" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "UnroutedTelnyxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UnroutedTelnyxEvent_createdAt_idx" ON "UnroutedTelnyxEvent"("createdAt");
CREATE INDEX "UnroutedTelnyxEvent_reason_createdAt_idx" ON "UnroutedTelnyxEvent"("reason", "createdAt");
CREATE INDEX "UnroutedTelnyxEvent_eventType_createdAt_idx" ON "UnroutedTelnyxEvent"("eventType", "createdAt");
