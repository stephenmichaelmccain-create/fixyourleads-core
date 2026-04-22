import { ProspectStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/redis';

const WORKER_HEARTBEAT_KEY = 'worker:runtime:heartbeat';
const HEARTBEAT_INTERVAL_MS = 60_000;
const FOLLOW_UP_SWEEP_INTERVAL_MS = 5 * 60_000;
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
  const activeStatusFilter = {
    notIn: INACTIVE_PROSPECT_STATUSES
  };

  const [overdueCount, dueTodayCount, dueNext7Count, sampleDue] = await Promise.all([
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
    })
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
