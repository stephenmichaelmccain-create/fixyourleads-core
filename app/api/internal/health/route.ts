import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { getRuntimeHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const health = await getRuntimeHealth();

  return NextResponse.json(
    {
      ...health,
      scope: 'internal'
    },
    { status: health.ok ? 200 : 503 }
  );
}
