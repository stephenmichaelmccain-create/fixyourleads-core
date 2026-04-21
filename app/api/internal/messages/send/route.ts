import { NextRequest, NextResponse } from 'next/server';
import { MessageDirection } from '@prisma/client';
import { requireApiKey } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { sendSms } from '@/lib/telnyx';

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { companyId, contactId, text } = body;

  if (!companyId || !contactId || !text) {
    return NextResponse.json({ error: 'companyId_contactId_text_required' }, { status: 400 });
  }

  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (!contact) {
    return NextResponse.json({ error: 'contact_not_found' }, { status: 404 });
  }

  const conversation = await db.conversation.upsert({
    where: { companyId_contactId: { companyId, contactId } },
    update: {},
    create: { companyId, contactId }
  });

  const telnyxResult = await sendSms(contact.phone, text);

  const message = await db.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      content: text,
      externalId: telnyxResult?.data?.id || null
    }
  });

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'manual_message_sent',
      payload: { messageId: message.id, contactId }
    }
  });

  return NextResponse.json({ ok: true, message });
}
