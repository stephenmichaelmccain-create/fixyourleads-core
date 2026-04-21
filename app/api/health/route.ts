import { NextResponse } from 'next/server';
import { getRuntimeHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await getRuntimeHealth();

  return NextResponse.json({
    ...health,
    live: true
  });
}
