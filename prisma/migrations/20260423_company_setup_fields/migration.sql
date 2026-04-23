-- Add minimal client setup fields (identity, primary contact, payment)
ALTER TABLE "Company" ADD COLUMN "website" TEXT;
ALTER TABLE "Company" ADD COLUMN "primaryContactName" TEXT;
ALTER TABLE "Company" ADD COLUMN "primaryContactEmail" TEXT;
ALTER TABLE "Company" ADD COLUMN "primaryContactPhone" TEXT;
ALTER TABLE "Company" ADD COLUMN "retainerCents" INTEGER;
ALTER TABLE "Company" ADD COLUMN "downPaymentCents" INTEGER;

