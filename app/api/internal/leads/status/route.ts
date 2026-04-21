import { NextRequest, NextResponse } from 'next/server';
import { LeadStatus } from '@prisma/client';
import { requireApiKey } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { leadId, status } = body;

  if (!leadId || !status) {
    return NextResponse.json({ error: 'leadId_and_status_required' }, { status: 400 });
  }

  if (!Object.values(LeadStatus).includes(status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }

  const lead = await db.lead.update({ where: { id: leadId }, data: { status } });
  return NextResponse.json({ ok: true, lead });
}
