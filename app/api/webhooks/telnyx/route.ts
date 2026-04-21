import { NextRequest, NextResponse } from 'next/server';
import { telnyxWebhookSchema } from '@/lib/security';
import { getMessageQueue } from '@/lib/queue';
import { db } from '@/lib/db';
import { storeInboundMessage } from '@/services/messaging';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = telnyxWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const { companyId, messageId, from, text } = parsed.data;

  const existing = await db.idempotencyKey.findUnique({
    where: { companyId_key: { companyId, key: messageId } }
  });

  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await db.idempotencyKey.create({
    data: { companyId, key: messageId }
  });

  const result = await storeInboundMessage(companyId, from, text, messageId);

  await getMessageQueue().add('handle_incoming_message', {
    companyId,
    contactId: result.contact.id,
    conversationId: result.conversation.id,
    messageId: result.message.id,
    text
  });

  return NextResponse.json({ ok: true });
}
