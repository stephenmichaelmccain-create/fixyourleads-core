import { LeadStatus, MessageDirection, WorkflowType } from '@prisma/client';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { companyPrimaryInboundNumber } from '@/lib/inbound-numbers';
import { sendSms } from '@/lib/telnyx';
import { activateWorkflowRun, ensurePhoneChannelIdentities, touchWorkflowActivity } from '@/lib/workflows';

export async function storeInboundMessage(
  companyId: string,
  phone: string,
  content: string,
  externalId: string,
  inboundNumber?: string | null
) {
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
      payload: {
        messageId: message.id,
        conversationId: conversation.id,
        leadId: lead.id,
        from: normalizedPhone,
        to: inboundNumber || null
      }
    }
  });

  await ensurePhoneChannelIdentities(companyId, contact.id, normalizedPhone);
  await activateWorkflowRun({
    companyId,
    contactId: contact.id,
    conversationId: conversation.id,
    leadId: lead.id,
    workflowType: WorkflowType.ACTIVE_CONVERSATION,
    reason: 'inbound_message_received',
    lastInboundAt: message.createdAt,
    payload: {
      from: normalizedPhone,
      to: inboundNumber || null
    }
  });

  return { contact, conversation, lead, message };
}

export async function sendOutboundMessage(companyId: string, contactId: string, content: string, eventType = 'manual_message_sent') {
  const contact = await db.contact.findFirst({
    where: {
      id: contactId,
      companyId
    }
  });

  if (!contact) {
    throw new Error('contact_not_found_for_company');
  }

  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      telnyxInboundNumber: true,
      telnyxInboundNumbers: {
        select: { number: true }
      }
    }
  });
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

  const senderNumber = companyPrimaryInboundNumber(company);
  const telnyxResult = await sendSms(contact.phone, content, senderNumber);

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
      payload: {
        messageId: message.id,
        contactId,
        conversationId: conversation.id,
        from: senderNumber,
        to: contact.phone
      }
    }
  });

  await ensurePhoneChannelIdentities(companyId, contactId, contact.phone);
  await touchWorkflowActivity({
    companyId,
    contactId,
    direction: 'outbound',
    when: message.createdAt
  });

  return { conversation, message, telnyxResult };
}

type TelnyxDeliveryContext = {
  companyId: string | null;
  internalMessageId: string | null;
  conversationId: string | null;
  matchedBy: 'message_external_id' | 'company_number' | 'unmatched';
};

type RecordTelnyxMessageLifecycleEventInput = {
  companyId: string;
  eventType: string;
  eventId: string;
  messageId: string;
  occurredAt?: string | null;
  deliveryStatus?: string | null;
  from?: string | null;
  to?: string | null;
  internalMessageId?: string | null;
  conversationId?: string | null;
  matchedBy: TelnyxDeliveryContext['matchedBy'];
  errors?: Array<{ code?: string; title?: string; detail?: string }>;
  attempt?: number | null;
  deliveredTo?: string | null;
};

function resolveTelnyxLifecycleEventType(eventType: string, deliveryStatus?: string | null) {
  if (eventType === 'message.sent') {
    return 'telnyx_message_sent';
  }

  if (eventType === 'message.finalized') {
    if (deliveryStatus === 'sending_failed' || deliveryStatus === 'delivery_failed') {
      return 'telnyx_message_delivery_failed';
    }

    if (deliveryStatus === 'delivery_unconfirmed') {
      return 'telnyx_message_delivery_unconfirmed';
    }

    return 'telnyx_message_finalized';
  }

  return 'telnyx_message_event';
}

export async function resolveTelnyxDeliveryContext(messageId: string, fromPhone?: string | null): Promise<TelnyxDeliveryContext> {
  const message = await db.message.findFirst({
    where: { externalId: messageId },
    select: {
      id: true,
      companyId: true,
      conversationId: true
    }
  });

  if (message) {
    return {
      companyId: message.companyId,
      internalMessageId: message.id,
      conversationId: message.conversationId,
      matchedBy: 'message_external_id'
    };
  }

  const normalizedFrom = normalizePhone(fromPhone || '');

  if (!normalizedFrom) {
    return {
      companyId: null,
      internalMessageId: null,
      conversationId: null,
      matchedBy: 'unmatched'
    };
  }

  const company = await db.company.findFirst({
    where: {
      OR: [
        { telnyxInboundNumber: normalizedFrom },
        {
          telnyxInboundNumbers: {
            some: {
              number: normalizedFrom
            }
          }
        }
      ]
    },
    select: { id: true }
  });

  if (!company) {
    return {
      companyId: null,
      internalMessageId: null,
      conversationId: null,
      matchedBy: 'unmatched'
    };
  }

  return {
    companyId: company.id,
    internalMessageId: null,
    conversationId: null,
    matchedBy: 'company_number'
  };
}

export async function recordTelnyxMessageLifecycleEvent({
  companyId,
  eventType,
  eventId,
  messageId,
  occurredAt,
  deliveryStatus,
  from,
  to,
  internalMessageId,
  conversationId,
  matchedBy,
  errors = [],
  attempt,
  deliveredTo
}: RecordTelnyxMessageLifecycleEventInput) {
  await db.eventLog.create({
    data: {
      companyId,
      eventType: resolveTelnyxLifecycleEventType(eventType, deliveryStatus),
      payload: {
        telnyxEventType: eventType,
        telnyxEventId: eventId,
        telnyxMessageId: messageId,
        occurredAt,
        deliveryStatus,
        from,
        to,
        internalMessageId,
        conversationId,
        matchedBy,
        errors,
        attempt,
        deliveredTo
      }
    }
  });
}
