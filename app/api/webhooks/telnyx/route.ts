import { NextRequest, NextResponse } from 'next/server';
import { normalizeTelnyxWebhook, verifyTelnyxWebhookSignature } from '@/lib/security';
import { getMessageQueue } from '@/lib/queue';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import {
  recordTelnyxMessageLifecycleEvent,
  resolveTelnyxDeliveryContext,
  storeInboundMessage
} from '@/services/messaging';

async function isDuplicateTelnyxEvent(companyId: string, key: string) {
  const existing = await db.idempotencyKey.findUnique({
    where: { companyId_key: { companyId, key } }
  });

  if (existing) {
    return true;
  }

  await db.idempotencyKey.create({
    data: { companyId, key }
  });

  return false;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureResult = verifyTelnyxWebhookSignature(
    rawBody,
    request.headers.get('telnyx-signature-ed25519'),
    request.headers.get('telnyx-timestamp')
  );

  if (!signatureResult.ok) {
    return NextResponse.json(
      { error: 'invalid_signature', reason: signatureResult.reason },
      { status: 401 }
    );
  }

  let body: unknown = null;

  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const normalized = normalizeTelnyxWebhook(body);

  if (!normalized) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const supportedEventTypes = new Set(['message.received', 'message.sent', 'message.finalized']);

  if (!supportedEventTypes.has(normalized.eventType)) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'event_not_supported' });
  }

  const idempotencyKey = `telnyx:${normalized.eventType}:${normalized.eventId || normalized.messageId}`;

  if (normalized.eventType === 'message.received') {
    let companyId = normalized.companyId;

    if (!companyId) {
      const inboundNumber = normalizePhone(normalized.to || '');

      if (!inboundNumber) {
        return NextResponse.json({ ok: true, ignored: true, reason: 'missing_inbound_number' });
      }

      const company = await db.company.findUnique({
        where: { telnyxInboundNumber: inboundNumber },
        select: { id: true }
      });

      if (!company) {
        return NextResponse.json({ ok: true, ignored: true, reason: 'no_company_for_inbound_number' });
      }

      companyId = company.id;
    }

    const { messageId, from, text } = normalized;

    if (!messageId || !from || !text) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'missing_message_identity_or_content' });
    }

    const duplicate = await isDuplicateTelnyxEvent(companyId, idempotencyKey);

    if (duplicate) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

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

  const deliveryContext = await resolveTelnyxDeliveryContext(normalized.messageId, normalized.from);

  if (!deliveryContext.companyId) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'no_company_for_message_event' });
  }

  const duplicate = await isDuplicateTelnyxEvent(deliveryContext.companyId, idempotencyKey);

  if (duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await recordTelnyxMessageLifecycleEvent({
    companyId: deliveryContext.companyId,
    eventType: normalized.eventType,
    eventId: normalized.eventId,
    messageId: normalized.messageId,
    occurredAt: normalized.occurredAt,
    deliveryStatus: normalized.deliveryStatus,
    from: normalized.from,
    to: normalized.to,
    internalMessageId: deliveryContext.internalMessageId,
    conversationId: deliveryContext.conversationId,
    matchedBy: deliveryContext.matchedBy,
    errors: normalized.errors
  });

  return NextResponse.json({ ok: true });
}
