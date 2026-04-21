import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { createLeadFlow } from '@/services/leads';

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const companyId = body.companyId || 'test-company';
  const phone = body.phone || '+15555550123';
  const name = body.name || 'Sample Lead';

  const result = await createLeadFlow(companyId, phone, name);
  return NextResponse.json({ ok: true, result });
}
