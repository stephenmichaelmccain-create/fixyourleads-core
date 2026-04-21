import { db } from '@/lib/db';

export async function createLeadFlow(companyId: string, phone: string, name?: string) {
  const contact = await db.contact.upsert({
    where: { companyId_phone: { companyId, phone } },
    update: { name: name || undefined },
    create: { companyId, phone, name }
  });

  const lead = await db.lead.create({
    data: { companyId, contactId: contact.id }
  });

  const conversation = await db.conversation.upsert({
    where: { companyId_contactId: { companyId, contactId: contact.id } },
    update: {},
    create: { companyId, contactId: contact.id }
  });

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'lead_created',
      payload: { leadId: lead.id, contactId: contact.id, conversationId: conversation.id }
    }
  });

  return { contact, lead, conversation };
}
