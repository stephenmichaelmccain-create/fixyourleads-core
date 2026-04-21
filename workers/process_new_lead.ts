import { Worker } from 'bullmq';
import { LeadStatus, MessageDirection } from '@prisma/client';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { sendSms } from '@/lib/telnyx';

new Worker('lead_queue', async (job) => {
  const { companyId, leadId, contactId, conversationId } = job.data;
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const text = `Hey ${contact.name || 'there'}, saw your request, want to book?`;
  const result = await sendSms(contact.phone, text);

  await db.message.create({
    data: {
      companyId,
      conversationId,
      direction: MessageDirection.OUTBOUND,
      content: text,
      externalId: result?.data?.id || null
    }
  });

  await db.lead.update({ where: { id: leadId }, data: { status: LeadStatus.CONTACTED } });
  await db.eventLog.create({ data: { companyId, eventType: 'message_sent', payload: { leadId, contactId } } });
}, { connection: getRedis() });
