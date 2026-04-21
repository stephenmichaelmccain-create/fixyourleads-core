import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const companyId = request.nextUrl.searchParams.get('companyId');
  if (!companyId) {
    return NextResponse.json({ error: 'companyId_required' }, { status: 400 });
  }

  const events = await db.eventLog.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: 200
  });

  return NextResponse.json({ ok: true, events });
}
