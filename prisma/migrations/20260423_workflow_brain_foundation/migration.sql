-- CreateEnum
CREATE TYPE "ContactChannelType" AS ENUM ('SMS', 'VOICE');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('NEW_LEAD_FOLLOW_UP', 'ACTIVE_CONVERSATION', 'BOOKING', 'NO_SHOW_RECOVERY', 'RECALL', 'REACTIVATION', 'REVIEW_REQUEST');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'RESCHEDULED', 'CANCELED', 'NO_SHOW', 'COMPLETED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "noShowAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED';

-- CreateTable
CREATE TABLE "ContactChannelIdentity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channelType" "ContactChannelType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactChannelIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "leadId" TEXT,
    "workflowType" "WorkflowType" NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL,
    "nextRunAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactChannelIdentity_contactId_channelType_idx" ON "ContactChannelIdentity"("contactId", "channelType");

-- CreateIndex
CREATE UNIQUE INDEX "ContactChannelIdentity_companyId_channelType_sourceId_key" ON "ContactChannelIdentity"("companyId", "channelType", "sourceId");

-- CreateIndex
CREATE INDEX "WorkflowRun_companyId_contactId_status_idx" ON "WorkflowRun"("companyId", "contactId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_companyId_contactId_workflowType_status_idx" ON "WorkflowRun"("companyId", "contactId", "workflowType", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_companyId_nextRunAt_idx" ON "WorkflowRun"("companyId", "nextRunAt");

-- AddForeignKey
ALTER TABLE "ContactChannelIdentity" ADD CONSTRAINT "ContactChannelIdentity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactChannelIdentity" ADD CONSTRAINT "ContactChannelIdentity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

