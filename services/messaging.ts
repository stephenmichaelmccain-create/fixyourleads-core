import { MessageDirection } from '@prisma/client';
import { db } from '@/lib/db';

export async function storeInboundMessage(companyId: string, phone: string, content: string, externalId: string) {
  const contact = await db.contact.findUniqueOrThrow({
    where: { companyId_phone: { companyId, phone } }
  });

  const conversation = await db.conversation.upsert({
    where: { companyId_contactId: { companyId, contactId: contact.id } },
    update: {},
    create: { companyId, contactId: contact.id }
  });

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
      payload: { messageId: message.id, conversationId: conversation.id }
    }
  });

  return { contact, conversation, message };
}
