import { NextResponse } from 'next/server';
import { getLeadQueueSessionId, refreshLeadClaim, releaseLeadClaim } from '@/app/our-leads/lead-claims.server';

export async function POST(request: Request) {
  const sessionId = await getLeadQueueSessionId();

  if (!sessionId) {
    return new NextResponse(null, { status: 204 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    action?: string;
    prospectId?: string;
  };
  const prospectId = String(payload.prospectId || '').trim();

  if (!prospectId) {
    return new NextResponse(null, { status: 204 });
  }

  if (payload.action === 'release') {
    await releaseLeadClaim(prospectId, sessionId);
  } else {
    await refreshLeadClaim(prospectId, sessionId);
  }

  return NextResponse.json({ ok: true });
}
