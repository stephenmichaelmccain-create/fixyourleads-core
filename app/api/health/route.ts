import { NextResponse } from 'next/server';
import { getRuntimeHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const health = await getRuntimeHealth();

  return NextResponse.json(
    {
      ...health,
      live: true,
      ready: health.ok
    },
    {
      status: health.ok ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Robots-Tag': 'noindex'
      }
    }
  );
}
