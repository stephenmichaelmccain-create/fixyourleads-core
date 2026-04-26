ALTER TABLE "Appointment"
ADD COLUMN "hostEmail" TEXT,
ADD COLUMN "attendeeEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
