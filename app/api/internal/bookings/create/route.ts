import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { createAppointmentFlow } from '@/services/booking';

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { companyId, contactId, startTime } = body;

  if (!companyId || !contactId) {
    return NextResponse.json({ error: 'companyId_and_contactId_required' }, { status: 400 });
  }

  if (startTime && Number.isNaN(new Date(startTime).getTime())) {
    return NextResponse.json({ error: 'invalid_startTime' }, { status: 400 });
  }

  const result = await createAppointmentFlow({
    companyId,
    contactId,
    startTime: startTime ? new Date(startTime) : undefined
  });

  return NextResponse.json({ ok: true, ...result });
}
