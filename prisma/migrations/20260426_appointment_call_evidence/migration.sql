-- Add first-class call evidence fields to appointments so recordings and transcripts
-- can be attached without relying on event-log-only payloads.
ALTER TABLE "Appointment"
ADD COLUMN "callExternalId" TEXT,
ADD COLUMN "callRecordingUrl" TEXT,
ADD COLUMN "callTranscriptUrl" TEXT,
ADD COLUMN "callTranscriptText" TEXT;
