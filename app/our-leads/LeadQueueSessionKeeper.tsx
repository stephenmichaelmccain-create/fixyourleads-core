'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  LEAD_QUEUE_CLAIM_TTL_SECONDS,
  LEAD_QUEUE_SESSION_COOKIE,
  LEAD_QUEUE_SESSION_MAX_AGE_SECONDS
} from './lead-queue-session.shared';

const HEARTBEAT_INTERVAL_MS = Math.max(30_000, Math.floor((LEAD_QUEUE_CLAIM_TTL_SECONDS * 1000) / 2));

function readCookie(name: string) {
  const cookies = document.cookie ? document.cookie.split('; ') : [];

  for (const entry of cookies) {
    const [key, ...valueParts] = entry.split('=');

    if (key === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return '';
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `lead-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function persistSessionCookie(sessionId: string) {
  document.cookie =
    `${LEAD_QUEUE_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; ` +
    `Path=/; Max-Age=${LEAD_QUEUE_SESSION_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function LeadQueueSessionKeeper({
  hasSession,
  selectedProspectId
}: {
  hasSession: boolean;
  selectedProspectId?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (hasSession || readCookie(LEAD_QUEUE_SESSION_COOKIE)) {
      return;
    }

    persistSessionCookie(createSessionId());
    startTransition(() => {
      router.refresh();
    });
  }, [hasSession, router, startTransition]);

  useEffect(() => {
    if (!selectedProspectId || !readCookie(LEAD_QUEUE_SESSION_COOKIE)) {
      return;
    }

    let isActive = true;

    const refreshClaim = () => {
      if (!isActive) {
        return;
      }

      void fetch('/api/internal/leads/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'refresh',
          prospectId: selectedProspectId
        }),
        keepalive: true
      }).catch(() => {});
    };

    refreshClaim();

    const timer = window.setInterval(refreshClaim, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [selectedProspectId]);

  return null;
}
