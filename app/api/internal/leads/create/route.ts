import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { createLeadFlow } from '@/services/leads';

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { companyId, phone, name } = body;

  if (!companyId || !phone) {
    return NextResponse.json({ error: 'companyId_and_phone_required' }, { status: 400 });
  }

  const result = await createLeadFlow(companyId, phone, name);
  return NextResponse.json({ ok: true, result });
}
