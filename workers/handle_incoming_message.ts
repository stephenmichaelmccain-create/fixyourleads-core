import { LeadStatus, WorkflowType } from '@prisma/client';
import { Worker } from 'bullmq';
import { getBookingQueue } from '@/lib/queue';
import { getRedis } from '@/lib/redis';
import { db } from '@/lib/db';
import { activateWorkflowRun, cancelWorkflowRunsForContact } from '@/lib/workflows';

const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'unsub']);
const START_KEYWORDS = new Set(['start', 'unstop']);
const HELP_KEYWORDS = new Set(['help']);
const WRONG_NUMBER_PHRASES = new Set(['wrong number', 'wrong person']);

function normalizeInboundText(text: unknown) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

new Worker('message_queue', async (job) => {
  const { companyId, contactId, text } = job.data;
  const normalized = normalizeInboundText(text);

  if (STOP_KEYWORDS.has(normalized) || WRONG_NUMBER_PHRASES.has(normalized)) {
    await db.lead.updateMany({
      where: { companyId, contactId },
      data: {
        status: LeadStatus.SUPPRESSED,
        suppressedAt: new Date(),
        suppressionReason: 'contact_requested_stop'
      }
    });
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'lead_suppressed',
        payload: { contactId, text, reason: 'contact_requested_stop' }
      }
    });
    await cancelWorkflowRunsForContact(companyId, contactId, 'contact_requested_stop');
    return;
  }

  if (START_KEYWORDS.has(normalized)) {
    await db.lead.updateMany({
      where: { companyId, contactId },
      data: {
        status: LeadStatus.REPLIED,
        lastRepliedAt: new Date(),
        suppressedAt: null,
        suppressionReason: null
      }
    });
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'lead_unsuppressed',
        payload: { contactId, text, reason: 'contact_requested_restart' }
      }
    });
    await activateWorkflowRun({
      companyId,
      contactId,
      workflowType: WorkflowType.ACTIVE_CONVERSATION,
      reason: 'contact_requested_restart',
      lastInboundAt: new Date()
    });
    return;
  }

  if (HELP_KEYWORDS.has(normalized)) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'contact_requested_help',
        payload: { contactId, text }
      }
    });
    await activateWorkflowRun({
      companyId,
      contactId,
      workflowType: WorkflowType.ACTIVE_CONVERSATION,
      reason: 'contact_requested_help',
      lastInboundAt: new Date()
    });
    return;
  }

  if (/\b(yes|book|booking)\b/.test(normalized)) {
    await activateWorkflowRun({
      companyId,
      contactId,
      workflowType: WorkflowType.BOOKING,
      reason: 'booking_intent_detected',
      lastInboundAt: new Date()
    });
    await getBookingQueue().add('booking_worker', { companyId, contactId, text });
    await db.eventLog.create({ data: { companyId, eventType: 'booking_intent_detected', payload: { contactId, text } } });
  }
}, { connection: getRedis() });
