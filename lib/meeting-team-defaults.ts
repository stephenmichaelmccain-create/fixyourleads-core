import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

export const INTERNAL_COMPANY_ID = 'fixyourleads';
const MEETING_DEFAULTS_EVENT = 'meeting_team_defaults_updated';

export type MeetingTeamDefaults = {
  defaultAttendeeEmails: string[];
};

function payloadRecord(payload: Prisma.JsonValue | null | undefined) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  return payload as Record<string, unknown>;
}

export function normalizeMeetingEmail(raw: string | null | undefined) {
  const value = String(raw || '').trim().toLowerCase();

  if (!value) {
    return null;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return null;
  }

  return value;
}

export function normalizeMeetingEmailList(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

  values.forEach((value) => {
    const normalized = normalizeMeetingEmail(value);
    if (normalized) {
      seen.add(normalized);
    }
  });

  return Array.from(seen);
}

export async function ensureInternalCompany() {
  await db.company.upsert({
    where: { id: INTERNAL_COMPANY_ID },
    update: {},
    create: {
      id: INTERNAL_COMPANY_ID,
      name: 'Fix Your Leads'
    }
  });
}

export async function getMeetingTeamDefaults(companyId = INTERNAL_COMPANY_ID): Promise<MeetingTeamDefaults> {
  const latest = await db.eventLog.findFirst({
    where: {
      companyId,
      eventType: MEETING_DEFAULTS_EVENT
    },
    orderBy: {
      createdAt: 'desc'
    },
    select: {
      payload: true
    }
  });

  const payload = payloadRecord(latest?.payload);
  const rawList = Array.isArray(payload.defaultAttendeeEmails) ? payload.defaultAttendeeEmails : [];

  return {
    defaultAttendeeEmails: normalizeMeetingEmailList(rawList.map((value) => String(value || '')))
  };
}

export async function saveMeetingTeamDefaults(defaultAttendeeEmails: string[], companyId = INTERNAL_COMPANY_ID) {
  await ensureInternalCompany();

  await db.eventLog.create({
    data: {
      companyId,
      eventType: MEETING_DEFAULTS_EVENT,
      payload: {
        defaultAttendeeEmails: normalizeMeetingEmailList(defaultAttendeeEmails)
      }
    }
  });
}
