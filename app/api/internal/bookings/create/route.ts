import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { createMockAppointment } from '@/services/booking';

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { companyId, contactId } = body;

  if (!companyId || !contactId) {
    return NextResponse.json({ error: 'companyId_and_contactId_required' }, { status: 400 });
  }

  const appointment = await createMockAppointment(companyId, contactId);
  return NextResponse.json({ ok: true, appointment });
}
