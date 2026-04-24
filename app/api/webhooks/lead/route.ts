import { NextRequest, NextResponse } from 'next/server';
import { leadWebhookSchema } from '@/lib/security';
import { getLeadQueue } from '@/lib/queue';
import { requireApiKey } from '@/lib/api-auth';
import { createLeadFlow } from '@/services/leads';

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = leadWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  try {
    const { companyId, phone, name, source, sourceExternalId } = parsed.data;
    const result = await createLeadFlow({ companyId, phone, name, source, sourceExternalId });

    if (result.queueInitialOutreach) {
      await getLeadQueue().add('process_new_lead', {
        companyId,
        leadId: result.lead.id,
        contactId: result.contact.id,
        conversationId: result.conversation.id
      });
    }

    return NextResponse.json({
      ok: true,
      leadId: result.lead.id,
      duplicate: result.duplicate,
      suppressed: result.suppressed,
      matchedBy: result.matchedBy
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_phone') {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
    }

    throw error;
  }
}
