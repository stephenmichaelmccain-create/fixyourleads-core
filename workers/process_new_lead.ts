import { Worker } from 'bullmq';
import { LeadStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { sendOutboundMessage } from '@/services/messaging';

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
  await sendOutboundMessage(companyId, contactId, text, 'message_sent');
  await db.lead.update({
    where: { id: leadId },
    data: { status: LeadStatus.CONTACTED, lastContactedAt: new Date() }
  });
}, { connection: getRedis() });
