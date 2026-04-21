import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { sendOutboundMessage } from '@/services/messaging';

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

  const { message } = await sendOutboundMessage(companyId, contactId, text);

  return NextResponse.json({ ok: true, message });
}
