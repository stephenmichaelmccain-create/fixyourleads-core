import { AppointmentExternalSyncStatus } from '@prisma/client';
import { createSign } from 'crypto';
import { db } from '@/lib/db';
import { parseClientCalendarSetupPayload, type ClientCalendarSetupState } from '@/lib/client-calendar-setup';
import { decryptJson } from '@/lib/encrypted-json';
import { getCalendarSyncQueue } from '@/lib/queue';
import { sendCalendarSyncFailureNotification } from '@/lib/notifications';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_PROVIDER = 'google_calendar';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

type StoredCalendarCredentials = {
  apiKey?: string | null;
  secondaryKey?: string | null;
};

type ResolvedCalendarSyncTarget =
  | {
      ok: true;
      provider: typeof GOOGLE_CALENDAR_PROVIDER;
      calendarId: string;
      timezone: string;
      durationMinutes: number;
      googleAccountEmail: string | null;
    }
  | {
      ok: false;
      reason: string;
      provider: string | null;
    };

export type AppointmentCalendarSyncResult = {
  success: boolean;
  provider: string | null;
  status: AppointmentExternalSyncStatus;
  externalEventId?: string | null;
  error?: string | null;
  retryable?: boolean;
};

type CalendarSyncFailureContext = {
  appointmentId: string;
  companyId: string;
  companyName: string;
  notificationEmail?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  appointmentTime: Date;
  provider: string | null;
  error: string;
};

export type SuggestedAppointmentSlot = {
  startTime: Date;
  timezone: string;
  durationMinutes: number;
  provider: string | null;
  source: 'calendar' | 'fallback';
};

function normalizeProviderName(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDurationMinutes(value?: string | null) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60;
  }

  return Math.min(parsed, 8 * 60);
}

function defaultTimezone() {
  return process.env.DEFAULT_CALENDAR_TIMEZONE?.trim() || 'America/Chicago';
}

function clean(value?: string | null) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function serviceAccountEmail() {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || '';
}

function serviceAccountPrivateKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim() || '';
  return raw ? raw.replace(/\\n/g, '\n') : '';
}

function serviceAccountConfigured() {
  return Boolean(serviceAccountEmail() && serviceAccountPrivateKey());
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createGoogleServiceAccountJwt() {
  const iss = serviceAccountEmail();
  const privateKey = serviceAccountPrivateKey();

  if (!iss || !privateKey) {
    throw new Error('google_service_account_not_configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss,
      scope: GOOGLE_CALENDAR_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now
    })
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(privateKey));

  return `${signingInput}.${signature}`;
}

async function requestGoogleAccessTokenFromServiceAccount() {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createGoogleServiceAccountJwt()
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || 'google_access_token_request_failed');
  }

  return payload.access_token;
}

function readStoredAccessToken(credentialsEncrypted?: string | null) {
  try {
    const decrypted = decryptJson<StoredCalendarCredentials>(credentialsEncrypted) || {};
    return String(decrypted.apiKey || '').trim() || '';
  } catch {
    return '';
  }
}

function isRetryableCalendarSyncError(message?: string | null) {
  const value = String(message || '').trim().toLowerCase();

  if (!value) {
    return true;
  }

  const permanentErrors = new Set([
    'calendar_sync_not_configured',
    'unsupported_calendar_provider',
    'google_calendar_id_missing',
    'google_calendar_credentials_missing',
    'google_service_account_not_configured'
  ]);

  return !permanentErrors.has(value);
}

async function resolveGoogleAccessToken(credentialsEncrypted?: string | null) {
  if (serviceAccountConfigured()) {
    return requestGoogleAccessTokenFromServiceAccount();
  }

  const storedAccessToken = readStoredAccessToken(credentialsEncrypted);

  if (storedAccessToken) {
    return storedAccessToken;
  }

  throw new Error('google_calendar_credentials_missing');
}

function resolveCalendarSyncTarget(state: ClientCalendarSetupState): ResolvedCalendarSyncTarget {
  const providerName = normalizeProviderName(state.externalPlatformName);
  const calendarId = state.googleCalendarId || state.externalCalendarId || '';
  const googleConfigured = Boolean(state.googleCalendarId || providerName.includes('google'));

  if (!googleConfigured && !calendarId) {
    return {
      ok: false,
      reason: 'calendar_sync_not_configured',
      provider: null
    };
  }

  if (!googleConfigured) {
    return {
      ok: false,
      reason: 'unsupported_calendar_provider',
      provider: providerName || null
    };
  }

  if (!calendarId.trim()) {
    return {
      ok: false,
      reason: 'google_calendar_id_missing',
      provider: GOOGLE_CALENDAR_PROVIDER
    };
  }

  return {
    ok: true,
    provider: GOOGLE_CALENDAR_PROVIDER,
    calendarId: calendarId.trim(),
    timezone: state.timezone || defaultTimezone(),
    durationMinutes: normalizeDurationMinutes(state.defaultDurationMinutes),
    googleAccountEmail: state.googleAccountEmail
  };
}

async function latestCalendarSetup(companyId: string) {
  const latestSetupEvent = await db.eventLog.findFirst({
    where: {
      companyId,
      eventType: 'client_calendar_setup_updated'
    },
    orderBy: { createdAt: 'desc' },
    select: {
      payload: true
    }
  });

  const payload =
    latestSetupEvent?.payload && typeof latestSetupEvent.payload === 'object' && !Array.isArray(latestSetupEvent.payload)
      ? (latestSetupEvent.payload as Record<string, unknown>)
      : {};

  return {
    state: parseClientCalendarSetupPayload(latestSetupEvent?.payload),
    credentialsEncrypted:
      typeof payload.externalPlatformCredentialsEncrypted === 'string'
        ? payload.externalPlatformCredentialsEncrypted.trim()
        : ''
  };
}

function calendarEventSummary(companyName: string, contactName: string | null, contactPhone: string) {
  const label = contactName?.trim() || contactPhone;
  return `${companyName} call with ${label}`;
}

function calendarEventDescription(input: {
  appointmentId: string;
  companyName: string;
  contactName: string | null;
  contactPhone: string;
  contactEmail: string | null;
  hostEmail: string | null;
  attendeeEmails: string[];
  notes: string | null;
}) {
  return [
    `Fix Your Leads appointment`,
    `Appointment ID: ${input.appointmentId}`,
    `Client: ${input.companyName}`,
    `Contact: ${input.contactName?.trim() || 'Unnamed contact'}`,
    `Phone: ${input.contactPhone}`,
    `Email: ${input.contactEmail?.trim() || 'Unknown'}`,
    `Host: ${input.hostEmail?.trim() || 'None assigned'}`,
    `Auto-added attendees: ${input.attendeeEmails.length > 0 ? input.attendeeEmails.join(', ') : 'None'}`,
    '',
    input.notes?.trim() || 'No appointment notes'
  ].join('\n');
}

async function createGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  timezone: string;
  startTime: Date;
  durationMinutes: number;
  summary: string;
  description: string;
  attendeeEmails: string[];
}) {
  const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000);
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?conferenceDataVersion=1`,
    {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      attendees: input.attendeeEmails.map((email) => ({ email })),
      start: {
        dateTime: input.startTime.toISOString(),
        timeZone: input.timezone
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: input.timezone
      },
      conferenceData: {
        createRequest: {
          requestId: `fyl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      }
    })
  }
  );

  const payload = (await response.json().catch(() => null)) as
    | { id?: string; htmlLink?: string; hangoutLink?: string; error?: { message?: string } }
    | null;

  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error?.message || 'google_calendar_event_create_failed');
  }

  return {
    id: payload.id,
    meetingUrl: clean(payload.hangoutLink) || clean(payload.htmlLink)
  };
}

function calendarSyncAlertRecipient(notificationEmail?: string | null) {
  return (
    clean(process.env.OPERATOR_ALERT_EMAIL) ||
    clean(process.env.VOICE_DEMO_OWNER_EMAIL) ||
    clean(process.env.DEFAULT_CLIENT_NOTIFICATION_EMAIL) ||
    clean(notificationEmail) ||
    clean(process.env.NOTIFICATION_FROM_EMAIL) ||
    clean(process.env.SMTP_USER)
  );
}

export async function notifyCalendarSyncFailure(input: CalendarSyncFailureContext) {
  return sendCalendarSyncFailureNotification({
    to: calendarSyncAlertRecipient(input.notificationEmail),
    companyName: input.companyName,
    provider: input.provider || GOOGLE_CALENDAR_PROVIDER,
    error: input.error,
    appointmentId: input.appointmentId,
    appointmentTime: input.appointmentTime,
    contactName: input.contactName,
    contactPhone: input.contactPhone
  });
}

export async function enqueueAppointmentCalendarSyncRetry(appointmentId: string, reason = 'calendar_sync_failed') {
  if (!process.env.REDIS_URL) {
    return { queued: false };
  }

  await getCalendarSyncQueue().add(
    'appointment_calendar_sync',
    {
      appointmentId,
      reason
    },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5 * 60 * 1000
      },
      removeOnComplete: 100,
      removeOnFail: 500
    }
  );

  return { queued: true };
}

export async function syncAppointmentToExternalCalendar(
  appointmentId: string,
  source = 'manual'
): Promise<AppointmentCalendarSyncResult> {
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      companyId: true,
      contactId: true,
      startTime: true,
      hostEmail: true,
      meetingUrl: true,
      attendeeEmails: true,
      notes: true,
      externalSyncAttempts: true,
      company: {
        select: {
          name: true
        }
      },
      contact: {
        select: {
          name: true,
          phone: true,
          email: true
        }
      }
    }
  });

  if (!appointment) {
    throw new Error('appointment_not_found');
  }

  const attemptNumber = appointment.externalSyncAttempts + 1;
  await db.appointment.update({
    where: { id: appointment.id },
    data: {
      externalSyncAttempts: {
        increment: 1
      }
    }
  });

  const setup = await latestCalendarSetup(appointment.companyId);
  const target = resolveCalendarSyncTarget(setup.state);

  if (!target.ok) {
    await db.appointment.update({
      where: { id: appointment.id },
      data: {
        externalCalendarProvider: target.provider,
        externalSyncStatus: AppointmentExternalSyncStatus.FAILED,
        externalSyncError: target.reason
      }
    });

    await db.eventLog.create({
      data: {
        companyId: appointment.companyId,
        eventType: 'appointment_calendar_sync_failed',
        payload: {
          appointmentId: appointment.id,
          contactId: appointment.contactId,
          provider: target.provider,
          source,
          reason: target.reason,
          attempt: attemptNumber
        }
      }
    });

    return {
      success: false,
      provider: target.provider,
      status: AppointmentExternalSyncStatus.FAILED,
      error: target.reason,
      retryable: isRetryableCalendarSyncError(target.reason)
    };
  }

  try {
    const accessToken = await resolveGoogleAccessToken(setup.credentialsEncrypted);
    const createdEvent = await createGoogleCalendarEvent({
      accessToken,
      calendarId: target.calendarId,
      timezone: target.timezone,
      startTime: appointment.startTime,
      durationMinutes: target.durationMinutes,
        summary: calendarEventSummary(appointment.company.name, appointment.contact.name, appointment.contact.phone),
        description: calendarEventDescription({
          appointmentId: appointment.id,
          companyName: appointment.company.name,
          contactName: appointment.contact.name,
          contactPhone: appointment.contact.phone,
          contactEmail: appointment.contact.email,
          hostEmail: appointment.hostEmail,
          attendeeEmails: appointment.attendeeEmails,
          notes: appointment.notes
        }),
        attendeeEmails: appointment.attendeeEmails
      });

    await db.appointment.update({
      where: { id: appointment.id },
      data: {
        externalCalendarProvider: target.provider,
        externalCalendarEventId: createdEvent.id,
        meetingUrl: appointment.meetingUrl || createdEvent.meetingUrl || appointment.meetingUrl,
        externalSyncStatus: AppointmentExternalSyncStatus.SYNCED,
        externalSyncError: null,
        externalSyncedAt: new Date()
      }
    });

    await db.eventLog.create({
      data: {
        companyId: appointment.companyId,
        eventType: 'appointment_calendar_sync_succeeded',
        payload: {
          appointmentId: appointment.id,
          contactId: appointment.contactId,
          provider: target.provider,
          source,
          externalEventId: createdEvent.id,
          meetingUrl: createdEvent.meetingUrl || null,
          attempt: attemptNumber,
          calendarId: target.calendarId
        }
      }
    });

    return {
      success: true,
      provider: target.provider,
      status: AppointmentExternalSyncStatus.SYNCED,
      externalEventId: createdEvent.id,
      retryable: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'calendar_sync_failed';

    await db.appointment.update({
      where: { id: appointment.id },
      data: {
        externalCalendarProvider: target.provider,
        externalSyncStatus: AppointmentExternalSyncStatus.FAILED,
        externalSyncError: message
      }
    });

    await db.eventLog.create({
      data: {
        companyId: appointment.companyId,
        eventType: 'appointment_calendar_sync_failed',
        payload: {
          appointmentId: appointment.id,
          contactId: appointment.contactId,
          provider: target.provider,
          source,
          reason: message,
          attempt: attemptNumber,
          calendarId: target.calendarId
        }
      }
    });

    return {
      success: false,
      provider: target.provider,
      status: AppointmentExternalSyncStatus.FAILED,
      error: message,
      retryable: isRetryableCalendarSyncError(message)
    };
  }
}

function roundUpToStep(date: Date, stepMinutes: number) {
  const stepMs = stepMinutes * 60_000;
  const value = date.getTime();
  const rounded = Math.ceil(value / stepMs) * stepMs;
  return new Date(rounded);
}

function overlapsBusyWindow(start: Date, end: Date, busyWindows: Array<{ start: Date; end: Date }>) {
  for (const window of busyWindows) {
    if (start < window.end && end > window.start) {
      return true;
    }
  }

  return false;
}

function fallbackSuggestedSlot() {
  const base = new Date();
  base.setDate(base.getDate() + 1);
  base.setHours(10, 0, 0, 0);
  return base;
}

export async function suggestNextAppointmentSlot(
  companyId: string,
  input?: { lookaheadDays?: number; minLeadMinutes?: number }
): Promise<SuggestedAppointmentSlot> {
  const setup = await latestCalendarSetup(companyId);
  const target = resolveCalendarSyncTarget(setup.state);
  const lookaheadDays = Math.max(input?.lookaheadDays || 14, 1);
  const minLeadMinutes = Math.max(input?.minLeadMinutes || 90, 0);

  if (!target.ok) {
    return {
      startTime: fallbackSuggestedSlot(),
      timezone: defaultTimezone(),
      durationMinutes: 60,
      provider: target.provider,
      source: 'fallback'
    };
  }

  try {
    const accessToken = await resolveGoogleAccessToken(setup.credentialsEncrypted);
    const now = new Date();
    const windowStart = new Date(now.getTime() + minLeadMinutes * 60_000);
    const windowEnd = new Date(windowStart.getTime() + lookaheadDays * 24 * 60 * 60_000);

    const freeBusyResponse = await fetch(`${GOOGLE_CALENDAR_API_BASE}/freeBusy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        timeZone: target.timezone,
        items: [{ id: target.calendarId }]
      })
    });

    const freeBusyPayload = (await freeBusyResponse.json().catch(() => null)) as
      | {
          calendars?: Record<
            string,
            {
              busy?: Array<{ start?: string; end?: string }>;
            }
          >;
          error?: { message?: string };
        }
      | null;

    if (!freeBusyResponse.ok) {
      throw new Error(freeBusyPayload?.error?.message || 'google_calendar_freebusy_failed');
    }

    const busyRaw = freeBusyPayload?.calendars?.[target.calendarId]?.busy || [];
    const busyWindows = busyRaw
      .map((item) => {
        const start = item?.start ? new Date(item.start) : null;
        const end = item?.end ? new Date(item.end) : null;

        if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return null;
        }

        return { start, end };
      })
      .filter((item): item is { start: Date; end: Date } => Boolean(item))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const durationMs = target.durationMinutes * 60_000;
    let candidate = roundUpToStep(windowStart, 30);

    while (candidate.getTime() + durationMs <= windowEnd.getTime()) {
      const end = new Date(candidate.getTime() + durationMs);

      if (!overlapsBusyWindow(candidate, end, busyWindows)) {
        return {
          startTime: candidate,
          timezone: target.timezone,
          durationMinutes: target.durationMinutes,
          provider: target.provider,
          source: 'calendar'
        };
      }

      candidate = new Date(candidate.getTime() + 30 * 60_000);
    }
  } catch {
    // Fallback to deterministic slot when calendar availability cannot be queried.
  }

  return {
    startTime: fallbackSuggestedSlot(),
    timezone: target.timezone,
    durationMinutes: target.durationMinutes,
    provider: target.provider,
    source: 'fallback'
  };
}
