import { AppointmentExternalSyncStatus, ProspectStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { enqueueAppointmentCalendarSyncRetry } from '@/services/calendar-sync';

const WORKER_HEARTBEAT_KEY = 'worker:runtime:heartbeat';
const HEARTBEAT_INTERVAL_MS = 60_000;
const FOLLOW_UP_SWEEP_INTERVAL_MS = 5 * 60_000;
const STALE_PENDING_APPOINTMENT_MS = 60 * 60 * 1000;
const FAILED_APPOINTMENT_RETRY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const STALE_UNROUTED_EVENT_MS = 24 * 60 * 60 * 1000;
const VOICE_AUTO_RETRY_MAX_ATTEMPTS = 3;
const VOICE_AUTO_RETRY_BATCH_SIZE = 25;
const VOICE_RETRY_DEDUPE_TTL_SECONDS = 30 * 60;
const QUIET_HOURS = {
  startHourLocal: 9,
  endHourLocal: 21
} as const;
const FREQUENCY_CAP_PER_LEAD_PER_WEEK = 3;
const INACTIVE_PROSPECT_STATUSES = [ProspectStatus.BOOKED_DEMO, ProspectStatus.CLOSED, ProspectStatus.DEAD];

let started = false;

type DueProspectSample = {
  id: string;
  name: string;
  city: string | null;
  status: ProspectStatus;
  nextActionAt: string;
};

type VoiceAppointmentSample = {
  id: string;
  companyId: string;
  companyName: string;
  contactName: string | null;
  startTime: string;
  createdAt: string;
  externalSyncAttempts: number;
  externalSyncError: string | null;
};

type UnroutedEventSample = {
  id: string;
  eventType: string;
  reason: string;
  inboundNumber: string | null;
  fromNumber: string | null;
  createdAt: string;
};

export type WorkerHeartbeatSummary = {
  lastSeenAt: string | null;
  lastSweepAt: string | null;
  autoSendEnabled: false;
  quietHours: typeof QUIET_HOURS;
  frequencyCapPerLeadPerWeek: number;
  followUp: {
    overdueCount: number;
    dueTodayCount: number;
    dueNext7Count: number;
    sampleDue: DueProspectSample[];
  };
  voice: {
    stalePendingCount: number;
    recentFailedCount: number;
    staleUnroutedCount: number;
    queuedPendingRetries: number;
    queuedFailedRetries: number;
    samplePending: VoiceAppointmentSample[];
    sampleFailed: VoiceAppointmentSample[];
    sampleUnrouted: UnroutedEventSample[];
  };
};

export function emptyWorkerHeartbeatSummary(): WorkerHeartbeatSummary {
  return {
    lastSeenAt: null,
    lastSweepAt: null,
    autoSendEnabled: false,
    quietHours: QUIET_HOURS,
    frequencyCapPerLeadPerWeek: FREQUENCY_CAP_PER_LEAD_PER_WEEK,
    followUp: {
      overdueCount: 0,
      dueTodayCount: 0,
      dueNext7Count: 0,
      sampleDue: []
    },
    voice: {
      stalePendingCount: 0,
      recentFailedCount: 0,
      staleUnroutedCount: 0,
      queuedPendingRetries: 0,
      queuedFailedRetries: 0,
      samplePending: [],
      sampleFailed: [],
      sampleUnrouted: []
    }
  };
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

async function writeSummary(summary: WorkerHeartbeatSummary) {
  await getRedis().set(WORKER_HEARTBEAT_KEY, JSON.stringify(summary));
}

async function queueVoiceRetryIfAllowed(appointmentId: string, reason: string) {
  if (!process.env.REDIS_URL) {
    return enqueueAppointmentCalendarSyncRetry(appointmentId, reason);
  }

  const dedupeKey = `worker:voice-retry:${reason}:${appointmentId}`;
  const claimed = await getRedis().set(dedupeKey, new Date().toISOString(), 'EX', VOICE_RETRY_DEDUPE_TTL_SECONDS, 'NX');

  if (claimed !== 'OK') {
    return { queued: false };
  }

  return enqueueAppointmentCalendarSyncRetry(appointmentId, reason);
}

export async function readWorkerHeartbeatSummary(): Promise<WorkerHeartbeatSummary> {
  try {
    const raw = await getRedis().get(WORKER_HEARTBEAT_KEY);

    if (!raw) {
      return emptyWorkerHeartbeatSummary();
    }

    const parsed = JSON.parse(raw) as Partial<WorkerHeartbeatSummary>;

    return {
      ...emptyWorkerHeartbeatSummary(),
      ...parsed,
      quietHours: QUIET_HOURS,
      frequencyCapPerLeadPerWeek: FREQUENCY_CAP_PER_LEAD_PER_WEEK,
      followUp: {
        ...emptyWorkerHeartbeatSummary().followUp,
        ...(parsed.followUp || {})
      },
      voice: {
        ...emptyWorkerHeartbeatSummary().voice,
        ...(parsed.voice || {})
      }
    };
  } catch {
    return emptyWorkerHeartbeatSummary();
  }
}

async function updateSummary(mutator: (current: WorkerHeartbeatSummary) => WorkerHeartbeatSummary) {
  const current = await readWorkerHeartbeatSummary();
  const next = mutator(current);
  await writeSummary(next);
  return next;
}

function formatAppointmentSample(sample: {
  id: string;
  companyId: string;
  startTime: Date;
  createdAt: Date;
  externalSyncAttempts: number;
  externalSyncError?: string | null;
  company: { name: string };
  contact: { name: string | null };
}): VoiceAppointmentSample {
  return {
    id: sample.id,
    companyId: sample.companyId,
    companyName: sample.company.name,
    contactName: sample.contact.name?.trim() || null,
    startTime: sample.startTime.toISOString(),
    createdAt: sample.createdAt.toISOString(),
    externalSyncAttempts: sample.externalSyncAttempts,
    externalSyncError: sample.externalSyncError || null
  };
}

export async function recordWorkerHeartbeatTick() {
  const timestamp = new Date().toISOString();

  return updateSummary((current) => ({
    ...current,
    lastSeenAt: timestamp
  }));
}

export async function runFollowUpHeartbeatSweep() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const nextWeekStart = addDays(todayStart, 7);
  const stalePendingCutoff = new Date(now.getTime() - STALE_PENDING_APPOINTMENT_MS);
  const recentFailedCutoff = new Date(now.getTime() - FAILED_APPOINTMENT_RETRY_LOOKBACK_MS);
  const staleUnroutedCutoff = new Date(now.getTime() - STALE_UNROUTED_EVENT_MS);
  const activeStatusFilter = {
    notIn: INACTIVE_PROSPECT_STATUSES
  };

  const [
    overdueCount,
    dueTodayCount,
    dueNext7Count,
    sampleDue,
    stalePendingCount,
    samplePending,
    pendingRetryCandidates,
    recentFailedCount,
    sampleFailed,
    failedRetryCandidates,
    staleUnroutedCount,
    sampleUnrouted
  ] = await Promise.all([
    db.prospect.count({
      where: {
        status: activeStatusFilter,
        nextActionAt: { lt: todayStart }
      }
    }),
    db.prospect.count({
      where: {
        status: activeStatusFilter,
        nextActionAt: {
          gte: todayStart,
          lt: tomorrowStart
        }
      }
    }),
    db.prospect.count({
      where: {
        status: activeStatusFilter,
        nextActionAt: {
          gte: tomorrowStart,
          lt: nextWeekStart
        }
      }
    }),
    db.prospect.findMany({
      where: {
        status: activeStatusFilter,
        nextActionAt: {
          lte: now
        }
      },
      orderBy: [{ nextActionAt: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
      select: {
        id: true,
        name: true,
        city: true,
        status: true,
        nextActionAt: true
      }
    }),
    db.appointment.count({
      where: {
        externalSyncStatus: AppointmentExternalSyncStatus.PENDING,
        createdAt: { lt: stalePendingCutoff }
      }
    }),
    db.appointment.findMany({
      where: {
        externalSyncStatus: AppointmentExternalSyncStatus.PENDING,
        createdAt: { lt: stalePendingCutoff }
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 5,
      select: {
        id: true,
        companyId: true,
        startTime: true,
        createdAt: true,
        externalSyncAttempts: true,
        company: {
          select: { name: true }
        },
        contact: {
          select: { name: true }
        }
      }
    }),
    db.appointment.findMany({
      where: {
        externalSyncStatus: AppointmentExternalSyncStatus.PENDING,
        createdAt: { lt: stalePendingCutoff },
        externalSyncAttempts: {
          lt: VOICE_AUTO_RETRY_MAX_ATTEMPTS
        }
      },
      orderBy: [{ createdAt: 'asc' }],
      take: VOICE_AUTO_RETRY_BATCH_SIZE,
      select: {
        id: true
      }
    }),
    db.appointment.count({
      where: {
        externalSyncStatus: AppointmentExternalSyncStatus.FAILED,
        createdAt: { gte: recentFailedCutoff },
        externalSyncAttempts: {
          lt: VOICE_AUTO_RETRY_MAX_ATTEMPTS
        }
      }
    }),
    db.appointment.findMany({
      where: {
        externalSyncStatus: AppointmentExternalSyncStatus.FAILED,
        createdAt: { gte: recentFailedCutoff },
        externalSyncAttempts: {
          lt: VOICE_AUTO_RETRY_MAX_ATTEMPTS
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 5,
      select: {
        id: true,
        companyId: true,
        startTime: true,
        createdAt: true,
        externalSyncAttempts: true,
        externalSyncError: true,
        company: {
          select: { name: true }
        },
        contact: {
          select: { name: true }
        }
      }
    }),
    db.appointment.findMany({
      where: {
        externalSyncStatus: AppointmentExternalSyncStatus.FAILED,
        createdAt: { gte: recentFailedCutoff },
        externalSyncAttempts: {
          lt: VOICE_AUTO_RETRY_MAX_ATTEMPTS
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      take: VOICE_AUTO_RETRY_BATCH_SIZE,
      select: {
        id: true
      }
    }),
    db.unroutedTelnyxEvent.count({
      where: {
        handledAt: null,
        createdAt: { lt: staleUnroutedCutoff }
      }
    }),
    db.unroutedTelnyxEvent.findMany({
      where: {
        handledAt: null,
        createdAt: { lt: staleUnroutedCutoff }
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 5,
      select: {
        id: true,
        eventType: true,
        reason: true,
        inboundNumber: true,
        fromNumber: true,
        createdAt: true
      }
    })
  ]);

  const [pendingRetryResults, failedRetryResults] = await Promise.all([
    Promise.all(
      pendingRetryCandidates.map((appointment) =>
        queueVoiceRetryIfAllowed(appointment.id, 'heartbeat_stale_pending')
      )
    ),
    Promise.all(
      failedRetryCandidates.map((appointment) =>
        queueVoiceRetryIfAllowed(appointment.id, 'heartbeat_recent_failed')
      )
    )
  ]);

  return updateSummary((current) => ({
    ...current,
    lastSeenAt: current.lastSeenAt || now.toISOString(),
    lastSweepAt: now.toISOString(),
    followUp: {
      overdueCount,
      dueTodayCount,
      dueNext7Count,
      sampleDue: sampleDue.map((prospect) => ({
        id: prospect.id,
        name: prospect.name,
        city: prospect.city,
        status: prospect.status,
        nextActionAt: prospect.nextActionAt?.toISOString() || now.toISOString()
      }))
    },
    voice: {
      stalePendingCount,
      recentFailedCount,
      staleUnroutedCount,
      queuedPendingRetries: pendingRetryResults.filter((result) => result.queued).length,
      queuedFailedRetries: failedRetryResults.filter((result) => result.queued).length,
      samplePending: samplePending.map(formatAppointmentSample),
      sampleFailed: sampleFailed.map(formatAppointmentSample),
      sampleUnrouted: sampleUnrouted.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        reason: event.reason,
        inboundNumber: event.inboundNumber || null,
        fromNumber: event.fromNumber || null,
        createdAt: event.createdAt.toISOString()
      }))
    }
  }));
}

async function safeHeartbeatTick() {
  try {
    await recordWorkerHeartbeatTick();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'worker_heartbeat_tick_failed',
        message: error instanceof Error ? error.message : 'unknown_error'
      })
    );
  }
}

async function safeFollowUpSweep() {
  try {
    await runFollowUpHeartbeatSweep();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'follow_up_heartbeat_sweep_failed',
        message: error instanceof Error ? error.message : 'unknown_error'
      })
    );
  }
}

export function startWorkerHeartbeat() {
  if (started) {
    return;
  }

  started = true;

  void safeHeartbeatTick();
  void safeFollowUpSweep();

  const heartbeatTimer = setInterval(() => {
    void safeHeartbeatTick();
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();

  const sweepTimer = setInterval(() => {
    void safeFollowUpSweep();
  }, FOLLOW_UP_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}
