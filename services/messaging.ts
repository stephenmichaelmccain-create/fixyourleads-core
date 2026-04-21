import { LeadStatus, MessageDirection } from '@prisma/client';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { sendSms } from '@/lib/telnyx';

export async function storeInboundMessage(companyId: string, phone: string, content: string, externalId: string) {
  const normalizedPhone = normalizePhone(phone);

  const contact = await db.contact.upsert({
    where: { companyId_phone: { companyId, phone: normalizedPhone } },
    update: { phone: normalizedPhone },
    create: { companyId, phone: normalizedPhone }
  });

  const conversation = await db.conversation.upsert({
    where: { companyId_contactId: { companyId, contactId: contact.id } },
    update: {},
    create: { companyId, contactId: contact.id }
  });

  let lead = await db.lead.findFirst({
    where: { companyId, contactId: contact.id },
    orderBy: { createdAt: 'desc' }
  });

  if (!lead) {
    lead = await db.lead.create({
      data: {
        companyId,
        contactId: contact.id,
        status: LeadStatus.REPLIED
      }
    });
  } else if (lead.status !== LeadStatus.BOOKED && lead.status !== LeadStatus.SUPPRESSED) {
    lead = await db.lead.update({
      where: { id: lead.id },
      data: {
        status: LeadStatus.REPLIED,
        lastRepliedAt: new Date()
      }
    });
  }

  const message = await db.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND,
      content,
      externalId
    }
  });

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'message_received',
      payload: { messageId: message.id, conversationId: conversation.id, leadId: lead.id }
    }
  });

  return { contact, conversation, lead, message };
}

export async function sendOutboundMessage(companyId: string, contactId: string, content: string, eventType = 'manual_message_sent') {
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const latestLead = await db.lead.findFirst({
    where: { companyId, contactId },
    orderBy: { createdAt: 'desc' }
  });

  if (latestLead?.status === LeadStatus.SUPPRESSED) {
    throw new Error('lead_suppressed');
  }

  const conversation = await db.conversation.upsert({
    where: { companyId_contactId: { companyId, contactId } },
    update: {},
    create: { companyId, contactId }
  });

  const telnyxResult = await sendSms(contact.phone, content);

  const message = await db.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      content,
      externalId: telnyxResult?.data?.id || null
    }
  });

  await db.lead.updateMany({
    where: {
      companyId,
      contactId,
      status: {
        in: [LeadStatus.NEW, LeadStatus.REPLIED, LeadStatus.CONTACTED]
      }
    },
    data: {
      status: LeadStatus.CONTACTED,
      lastContactedAt: new Date()
    }
  });

  await db.eventLog.create({
    data: {
      companyId,
      eventType,
      payload: { messageId: message.id, contactId, conversationId: conversation.id }
    }
  });

  return { conversation, message, telnyxResult };
}
