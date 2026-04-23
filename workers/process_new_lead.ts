import { Worker } from 'bullmq';
import { LeadStatus, WorkflowType } from '@prisma/client';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { scheduleWorkflowRun } from '@/lib/workflow-jobs';
import { sendOutboundMessage } from '@/services/messaging';
import { activateWorkflowRun } from '@/lib/workflows';

new Worker('lead_queue', async (job) => {
  const { companyId, leadId, contactId, conversationId } = job.data;
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });

  if (lead.status === LeadStatus.BOOKED || lead.status === LeadStatus.SUPPRESSED) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'lead_queue_skipped',
        payload: { leadId, contactId, conversationId, status: lead.status }
      }
    });
    return;
  }

  const text = `Hey ${contact.name || 'there'}, saw your request, want to book?`;
  const result = await sendOutboundMessage(companyId, contactId, text, 'message_sent');
  await db.lead.update({
    where: { id: leadId },
    data: { status: LeadStatus.CONTACTED, lastContactedAt: new Date() }
  });
  const workflowRun = await activateWorkflowRun({
    companyId,
    contactId,
    conversationId: result.conversation.id,
    leadId,
    workflowType: WorkflowType.NEW_LEAD_FOLLOW_UP,
    reason: 'initial_outbound_message_sent',
    lastOutboundAt: result.message.createdAt,
    nextRunAt: new Date(result.message.createdAt.getTime() + 24 * 60 * 60 * 1000),
    payload: {
      step: 'initial_outreach_sent'
    }
  });

  await scheduleWorkflowRun({
    workflowRunId: workflowRun.id,
    nextRunAt: workflowRun.nextRunAt
  });
}, { connection: getRedis() });
