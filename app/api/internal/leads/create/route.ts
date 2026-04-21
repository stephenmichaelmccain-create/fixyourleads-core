import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { createLeadFlow } from '@/services/leads';

const createLeadSchema = z.object({
  companyId: z.string().min(1),
  phone: z.string().min(7),
  name: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  sourceExternalId: z.string().trim().min(1).optional()
});

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

  const parsed = createLeadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  try {
    const result = await createLeadFlow(parsed.data);

    return NextResponse.json({
      ok: true,
      leadId: result.lead.id,
      contactId: result.contact.id,
      conversationId: result.conversation.id,
      duplicate: result.duplicate,
      suppressed: result.suppressed,
      matchedBy: result.matchedBy,
      normalizedPhone: result.normalizedPhone
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_phone') {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
    }

    throw error;
  }
}
