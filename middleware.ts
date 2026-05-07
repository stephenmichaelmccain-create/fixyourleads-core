import { NextRequest, NextResponse } from 'next/server';
import {
  LEAD_QUEUE_SESSION_COOKIE,
  LEAD_QUEUE_SESSION_MAX_AGE_SECONDS
} from '@/app/our-leads/lead-queue-session.shared';

export function middleware(request: NextRequest) {
  const existingSessionId = request.cookies.get(LEAD_QUEUE_SESSION_COOKIE)?.value?.trim();

  if (existingSessionId) {
    return NextResponse.next();
  }

  const sessionId = crypto.randomUUID();
  request.cookies.set(LEAD_QUEUE_SESSION_COOKIE, sessionId);

  const response = NextResponse.next();
  response.cookies.set({
    name: LEAD_QUEUE_SESSION_COOKIE,
    value: sessionId,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: LEAD_QUEUE_SESSION_MAX_AGE_SECONDS,
    secure: request.nextUrl.protocol === 'https:'
  });

  return response;
}

export const config = {
  matcher: ['/leads/:path*', '/our-leads/:path*']
};
