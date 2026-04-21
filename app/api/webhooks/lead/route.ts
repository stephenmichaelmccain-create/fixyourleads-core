import { NextRequest, NextResponse } from 'next/server';
import { leadWebhookSchema } from '@/lib/security';
import { leadQueue } from '@/lib/queue';
import { createLeadFlow } from '@/services/leads';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = leadWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const { companyId, phone, name } = parsed.data;
  const result = await createLeadFlow(companyId, phone, name);

  await leadQueue.add('process_new_lead', {
    companyId,
    leadId: result.lead.id,
    contactId: result.contact.id,
    conversationId: result.conversation.id
  });

  return NextResponse.json({ ok: true, leadId: result.lead.id });
}
