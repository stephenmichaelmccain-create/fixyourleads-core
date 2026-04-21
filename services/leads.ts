import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';

type CreateLeadFlowInput = {
  companyId: string;
  phone: string;
  name?: string;
  source?: string;
  sourceExternalId?: string;
};

export async function createLeadFlow({
  companyId,
  phone,
  name,
  source,
  sourceExternalId
}: CreateLeadFlowInput) {
  const normalizedPhone = normalizePhone(phone);

  const contact = await db.contact.upsert({
    where: { companyId_phone: { companyId, phone: normalizedPhone } },
    update: { name: name || undefined, phone: normalizedPhone },
    create: { companyId, phone: normalizedPhone, name }
  });

  const conversation = await db.conversation.upsert({
    where: { companyId_contactId: { companyId, contactId: contact.id } },
    update: {},
    create: { companyId, contactId: contact.id }
  });

  const existingLead = await db.lead.findFirst({
    where: { companyId, contactId: contact.id },
    orderBy: { createdAt: 'desc' }
  });

  if (existingLead) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'lead_reingested',
        payload: {
          leadId: existingLead.id,
          contactId: contact.id,
          conversationId: conversation.id,
          source: source || null,
          sourceExternalId: sourceExternalId || null
        }
      }
    });

    return {
      contact,
      lead: existingLead,
      conversation,
      duplicate: true,
      queueInitialOutreach: false
    };
  }

  const lead = await db.lead.create({
    data: {
      companyId,
      contactId: contact.id,
      source,
      sourceExternalId
    }
  });

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'lead_created',
      payload: { leadId: lead.id, contactId: contact.id, conversationId: conversation.id }
    }
  });

  return {
    contact,
    lead,
    conversation,
    duplicate: false,
    queueInitialOutreach: true
  };
}
