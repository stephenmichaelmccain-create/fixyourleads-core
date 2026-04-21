import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ ok: true, scope: 'internal' });
}
