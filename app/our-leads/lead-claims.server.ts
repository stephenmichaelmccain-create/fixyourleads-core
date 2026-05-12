import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { LEAD_QUEUE_CLAIM_TTL_SECONDS, LEAD_QUEUE_SESSION_COOKIE } from './lead-queue-session.shared';

type ProspectClaimSnapshot = {
  claimSessionId: string | null;
  claimExpiresAt: Date | null;
};

function hasDatabaseConnection() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function getClaimExpiry(now = new Date()) {
  return new Date(now.getTime() + LEAD_QUEUE_CLAIM_TTL_SECONDS * 1000);
}

export async function getLeadQueueSessionId() {
  const cookieStore = await cookies();
  return cookieStore.get(LEAD_QUEUE_SESSION_COOKIE)?.value?.trim() || '';
}

export function isLeadClaimActive(expiresAt: Date | null | undefined, now = new Date()) {
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

export function isProspectClaimedByAnotherSession(
  prospect: ProspectClaimSnapshot,
  sessionId: string,
  now = new Date()
) {
  if (!prospect.claimSessionId) {
    return false;
  }

  if (prospect.claimSessionId === sessionId) {
    return false;
  }

  return isLeadClaimActive(prospect.claimExpiresAt, now);
}

export async function releaseAllLeadClaimsForSession(sessionId: string, exceptProspectId?: string) {
  if (!sessionId || !hasDatabaseConnection()) {
    return;
  }

  await db.prospect.updateMany({
    where: {
      claimSessionId: sessionId,
      ...(exceptProspectId
        ? {
            NOT: {
              id: exceptProspectId
            }
          }
        : {})
    },
    data: {
      claimSessionId: null,
      claimExpiresAt: null
    }
  });
}

export async function claimFirstAvailableProspect(prospectIds: string[], sessionId: string) {
  if (!sessionId || !hasDatabaseConnection()) {
    return '';
  }

  if (prospectIds.length === 0) {
    await releaseAllLeadClaimsForSession(sessionId);
    return '';
  }

  const now = new Date();
  const claimExpiresAt = getClaimExpiry(now);

  for (const prospectId of prospectIds) {
    const claimed = await db.prospect.updateMany({
      where: {
        id: prospectId,
        OR: [
          { claimSessionId: null },
          { claimSessionId: sessionId },
          { claimExpiresAt: { lt: now } }
        ]
      },
      data: {
        claimSessionId: sessionId,
        claimExpiresAt
      }
    });

    if (claimed.count > 0) {
      await releaseAllLeadClaimsForSession(sessionId, prospectId);
      return prospectId;
    }
  }

  return '';
}

export async function refreshLeadClaim(prospectId: string, sessionId: string) {
  if (!prospectId || !sessionId || !hasDatabaseConnection()) {
    return;
  }

  await db.prospect.updateMany({
    where: {
      id: prospectId,
      claimSessionId: sessionId
    },
    data: {
      claimExpiresAt: getClaimExpiry()
    }
  });
}

export async function releaseLeadClaim(prospectId: string, sessionId: string) {
  if (!prospectId || !sessionId || !hasDatabaseConnection()) {
    return;
  }

  await db.prospect.updateMany({
    where: {
      id: prospectId,
      claimSessionId: sessionId
    },
    data: {
      claimSessionId: null,
      claimExpiresAt: null
    }
  });
}
