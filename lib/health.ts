import { db } from '@/lib/db';
import { notificationReadiness } from '@/lib/notifications';
import { getBookingQueue, getLeadQueue, getMessageQueue } from '@/lib/queue';
import { getRedis } from '@/lib/redis';
import { envPresence, missingRequiredEnvVars } from '@/lib/runtime-safe';
import { getTelnyxWebhookSecurityConfig } from '@/lib/security';
import { checkTelnyxConnectivity } from '@/lib/telnyx';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { emptyWorkerHeartbeatSummary, readWorkerHeartbeatSummary } from '@/lib/worker-heartbeat';

type CheckStatus = 'ok' | 'missing_config' | 'error';

type DependencyCheck = {
  status: CheckStatus;
  detail?: string;
  statusCode?: number;
  requestId?: string | null;
};

type QueueHealth = {
  name: string;
  status: CheckStatus;
  counts?: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    stalled: number;
  };
  failedJobs?: Array<{
    id: string;
    failedReason: string | null;
    attemptsMade: number;
    failedAt: string | null;
  }>;
  detail?: string;
};

function baseDeployment(env: ReturnType<typeof envPresence>) {
  return {
    nodeEnv: env.nodeEnv,
    serviceName: process.env.RAILWAY_SERVICE_NAME || 'fixyourleads-core',
    environmentName:
      process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'unknown',
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    uptimeSeconds: Math.round(process.uptime())
  };
}

function observabilitySummary(env: ReturnType<typeof envPresence>) {
  const sentryDsnSet = hasConfiguredEnv('SENTRY_DSN') || hasConfiguredEnv('NEXT_PUBLIC_SENTRY_DSN');

  return {
    structuredRuntimeLogs: true,
    sentryDsnSet,
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || env.nodeEnv || null
  };
}

function webhookVerificationCheck(telnyxWebhookSecurity: ReturnType<typeof getTelnyxWebhookSecurityConfig>): DependencyCheck {
  if (!telnyxWebhookSecurity.verificationEnabled) {
    return {
      status: 'missing_config',
      detail: `TELNYX_VERIFY_SIGNATURES is disabled; webhook authenticity is not enforced yet. Current timestamp tolerance is ${telnyxWebhookSecurity.timestampToleranceSeconds}s once enabled.`
    };
  }

  if (!telnyxWebhookSecurity.publicKeySet) {
    return {
      status: 'error',
      detail: 'TELNYX_VERIFY_SIGNATURES is enabled but TELNYX_PUBLIC_KEY is missing'
    };
  }

  return {
    status: 'ok',
    detail: `Webhook signature verification is enabled with a ${telnyxWebhookSecurity.timestampToleranceSeconds}s replay window`
  };
}

function notificationCheck(notifications: ReturnType<typeof notificationReadiness>): DependencyCheck {
  return notifications.smtpUserSet && notifications.smtpPasswordSet
    ? { status: 'ok', detail: 'SMTP notification path configured' }
    : {
        status: 'missing_config',
        detail: 'SMTP_USER and SMTP_PASSWORD are optional, but required for booking email notifications'
      };
}

function appBaseUrlCheck(env: ReturnType<typeof envPresence>): DependencyCheck {
  return env.appBaseUrlSet ? { status: 'ok' } : { status: 'missing_config', detail: 'APP_BASE_URL is missing' };
}

function telnyxApiKeyCheck(env: ReturnType<typeof envPresence>): DependencyCheck {
  return env.telnyxApiKeySet ? { status: 'ok' } : { status: 'missing_config', detail: 'TELNYX_API_KEY is missing' };
}

function telnyxFromNumberCheck(env: ReturnType<typeof envPresence>): DependencyCheck {
  return env.telnyxFromNumberSet ? { status: 'ok' } : { status: 'missing_config', detail: 'TELNYX_FROM_NUMBER is missing' };
}

function internalApiKeyCheck(env: ReturnType<typeof envPresence>): DependencyCheck {
  return env.internalApiKeySet ? { status: 'ok' } : { status: 'missing_config', detail: 'INTERNAL_API_KEY is missing' };
}

function observabilityCheck(sentryDsnSet: boolean): DependencyCheck {
  return sentryDsnSet
    ? { status: 'ok', detail: 'Sentry DSN is configured and structured runtime logs are enabled' }
    : {
        status: 'missing_config',
        detail: 'SENTRY_DSN is optional, but recommended; runtime errors still land in Railway logs as structured JSON'
      };
}

function workerHeartbeatCheck(summary: Awaited<ReturnType<typeof readWorkerHeartbeatSummary>>): DependencyCheck {
  if (!summary.lastSeenAt) {
    return {
      status: 'missing_config',
      detail: 'Worker heartbeat has not reported yet'
    };
  }

  const lastSeen = new Date(summary.lastSeenAt).getTime();

  if (!Number.isFinite(lastSeen)) {
    return {
      status: 'error',
      detail: 'Worker heartbeat timestamp is invalid'
    };
  }

  const ageMs = Date.now() - lastSeen;

  if (ageMs > 3 * 60 * 1000) {
    return {
      status: 'error',
      detail: `Worker heartbeat is stale (${Math.round(ageMs / 1000)}s old)`
    };
  }

  if (!summary.lastSweepAt) {
    return {
      status: 'missing_config',
      detail: 'Follow-up sweep has not run yet'
    };
  }

  return {
    status: 'ok',
    detail: `Worker heartbeat is live; last sweep ${summary.lastSweepAt}`
  };
}

function hasConfiguredEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'unknown_error';
}

async function checkDatabase(databaseUrlSet: boolean): Promise<DependencyCheck> {
  if (!databaseUrlSet) {
    return { status: 'missing_config', detail: 'DATABASE_URL is missing' };
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', detail: summarizeError(error) };
  }
}

async function checkRedis(redisUrlSet: boolean): Promise<DependencyCheck> {
  if (!redisUrlSet) {
    return { status: 'missing_config', detail: 'REDIS_URL is missing' };
  }

  try {
    const redis = getRedis();
    const result = await redis.ping();

    if (result !== 'PONG') {
      return { status: 'error', detail: `Unexpected ping response: ${result}` };
    }

    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', detail: summarizeError(error) };
  }
}

async function checkQueue(
  queueName: string,
  queueLoader: () => { getJobCounts: (...types: any[]) => Promise<Record<string, number>>; getFailed: (...args: any[]) => Promise<any[]> }
): Promise<QueueHealth> {
  try {
    const queue = queueLoader();
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'stalled');
    const failed = counts.failed || 0;
    const failedJobs = failed > 0 ? await queue.getFailed(0, 4) : [];

    return {
      name: queueName,
      status: failed > 0 ? 'error' : 'ok',
      detail: failed > 0 ? `${failed} failed jobs` : undefined,
      counts: {
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        delayed: counts.delayed || 0,
        completed: counts.completed || 0,
        failed,
        stalled: counts.stalled || 0
      },
      failedJobs: failedJobs.map((job) => ({
        id: String(job?.id),
        failedReason: job.failedReason || null,
        attemptsMade: job.attemptsMade || 0,
        failedAt: job.timestamp ? new Date(Number(job.timestamp)).toISOString() : null
      }))
    };
  } catch (error) {
    return {
      name: queueName,
      status: 'error',
      detail: summarizeError(error)
    };
  }
}

async function getQueueHealth(redisUrlSet: boolean): Promise<QueueHealth[]> {
  if (!redisUrlSet) {
    return ['lead_queue', 'message_queue', 'booking_queue'].map((name) => ({
      name,
      status: 'missing_config',
      detail: 'REDIS_URL is required to read queue stats'
    }));
  }

  return Promise.all([
    checkQueue('lead_queue', getLeadQueue),
    checkQueue('message_queue', getMessageQueue),
    checkQueue('booking_queue', getBookingQueue)
  ]);
}

function readEnvValue(keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];

    if (value?.trim()) {
      return value;
    }
  }

  return undefined;
}

export async function getRuntimeHealth() {
  const env = envPresence();
  const notifications = notificationReadiness();
  const telnyxWebhookSecurity = getTelnyxWebhookSecurityConfig();
  const appBaseUrl = process.env.APP_BASE_URL?.trim() || null;
  const sentryDsnSet = hasConfiguredEnv('SENTRY_DSN') || hasConfiguredEnv('NEXT_PUBLIC_SENTRY_DSN');
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    database,
    redis,
    telnyxConnection,
    companyRouting,
    volumeStats,
    activityStats,
    leadStatusRows,
    messageDirectionRows,
    eventTypeRows,
    latestEvents,
    latestLeads,
    latestMessages,
    queueHealth,
    workerHeartbeat
  ] = await Promise.all([
    checkDatabase(env.databaseUrlSet),
    checkRedis(env.redisUrlSet),
    checkTelnyxConnectivity(process.env.TELNYX_API_KEY),
    db.company.findMany({
      select: {
        id: true,
        name: true,
        notificationEmail: true,
        telnyxInboundNumber: true,
        telnyxInboundNumbers: {
          select: { number: true }
        }
      }
    }),
    Promise.all([
      db.company.count(),
      db.lead.count(),
      db.conversation.count(),
      db.appointment.count(),
      db.message.count(),
      db.eventLog.count()
    ]),
    Promise.all([
      db.eventLog.count({ where: { createdAt: { gte: last24Hours } } }),
      db.message.count({ where: { createdAt: { gte: last24Hours } } }),
      db.appointment.count({ where: { startTime: { gte: now } } }),
      db.lead.count({ where: { createdAt: { gte: last24Hours } } }),
      db.conversation.count({ where: { createdAt: { gte: last24Hours } } }),
      db.appointment.count({ where: { createdAt: { gte: last24Hours } } })
    ]),
    db.lead.groupBy({
      by: ['status'],
      _count: { _all: true }
    }),
    db.message.groupBy({
      by: ['direction'],
      where: { createdAt: { gte: last24Hours } },
      _count: { _all: true }
    }),
    db.eventLog.groupBy({
      by: ['eventType'],
      where: { createdAt: { gte: last24Hours } },
      _count: { _all: true },
      // Prisma doesn't expose `_count._all` ordering in all provider versions.
    }),
    db.eventLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        eventType: true,
        companyId: true,
        createdAt: true
      }
    }),
    db.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        createdAt: true,
        companyId: true
      }
    }),
    db.message.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        direction: true,
        createdAt: true,
        companyId: true
      }
    }),
    getQueueHealth(env.redisUrlSet),
    readWorkerHeartbeatSummary()
  ]);

  const deployment = baseDeployment(env);

  const companiesMissingNotification = companyRouting.filter((company) => !company.notificationEmail).length;
  const topRoutingGaps = companyRouting
    .filter((company) => !hasInboundRouting(company))
    .slice()
    .sort((left, right) => {
      const leftHasNotification = Number(Boolean(left.notificationEmail));
      const rightHasNotification = Number(Boolean(right.notificationEmail));

      if (leftHasNotification !== rightHasNotification) {
        return rightHasNotification - leftHasNotification;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, 10)
    .map((company) => ({
      id: company.id,
      name: company.name,
      notificationEmailSet: Boolean(company.notificationEmail)
    }));

  const numberToCompanies = new Map<string, { id: string; name: string }[]>();

  for (const company of companyRouting) {
    const numbers = allInboundNumbers(company);

    for (const number of numbers) {
      const entries = numberToCompanies.get(number) || [];
      entries.push({ id: company.id, name: company.name });
      numberToCompanies.set(number, entries);
    }
  }

  const routingConflicts = [...numberToCompanies.entries()]
    .filter(([, companies]) => companies.length > 1)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([number, companies]) => ({ number, companies }));

  const multiNumberCompanies = companyRouting
    .filter((company) => allInboundNumbers(company).length > 1)
    .slice()
    .sort((left, right) => {
      const leftCount = allInboundNumbers(left).length;
      const rightCount = allInboundNumbers(right).length;

      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, 8)
    .map((company) => ({
      id: company.id,
      name: company.name,
      inboundCount: allInboundNumbers(company).length
    }));

  const companiesWithRouting = companyRouting.filter((company) => hasInboundRouting(company)).length;
  const companiesMissingRouting = companyRouting.length - companiesWithRouting;
  const telnyxWebhookVerificationStatus = webhookVerificationCheck(telnyxWebhookSecurity);
  const telnyxRoutingStatus =
    companyRouting.length === 0
      ? ({
          status: 'missing_config',
          detail: 'No company workspaces exist yet'
        } satisfies DependencyCheck)
      : companiesMissingRouting === 0
        ? ({
            status: 'ok',
            detail: `All ${companyRouting.length} companies have inbound routing numbers`
          } satisfies DependencyCheck)
      : ({
          status: 'missing_config',
          detail: `${companiesMissingRouting} of ${companyRouting.length} companies are missing inbound routing number`
        } satisfies DependencyCheck);

  const missingRequiredEnv = missingRequiredEnvVars(env);
  const queueOk = queueHealth.every((entry) => entry.status !== 'error');
  const leadStatusBreakdown = leadStatusRows.map((row) => ({ status: row.status, count: row._count._all }));
  const messageDirectionBreakdown = messageDirectionRows.map((row) => ({
    direction: row.direction,
    count: row._count._all
  }));
  const topEventsLast24h = eventTypeRows
    .map((row) => ({ eventType: row.eventType, count: row._count._all }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);
  const recentEvents24h = latestEvents.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    companyId: row.companyId,
    createdAt: row.createdAt.toISOString()
  }));
  const ok =
    missingRequiredEnv.length === 0 &&
    database.status === 'ok' &&
    redis.status === 'ok' &&
    telnyxConnection.status === 'ok' &&
    queueOk;

  return {
    ok,
    service: 'fixyourleads-core',
    timestamp: new Date().toISOString(),
    deployment,
    observability: {
      structuredRuntimeLogs: true,
      sentryDsnSet,
      sentryEnvironment: process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || env.nodeEnv || null
    },
    env,
    telnyx: {
      companiesTotal: companyRouting.length,
      companiesWithRouting,
      companiesMissingRouting,
      companiesMissingNotification,
      topRoutingGaps,
      multiNumberCompanies,
      routingConflicts,
      apiStatus: telnyxConnection.status,
      apiStatusCode: telnyxConnection.statusCode || null,
      apiRequestId: telnyxConnection.requestId || null,
      apiDetail: telnyxConnection.detail || null,
      webhookUrl: appBaseUrl ? new URL('/api/webhooks/telnyx', appBaseUrl).toString() : null,
      signatureVerificationEnabled: telnyxWebhookSecurity.verificationEnabled,
      publicKeySet: telnyxWebhookSecurity.publicKeySet,
      signatureMaxAgeSeconds: telnyxWebhookSecurity.timestampToleranceSeconds
    },
    volume: {
      companies: volumeStats[0],
      leads: volumeStats[1],
      conversations: volumeStats[2],
      appointments: volumeStats[3],
      messages: volumeStats[4],
      events: volumeStats[5],
      eventsLast24h: activityStats[0],
      messagesLast24h: activityStats[1],
      upcomingAppointments: activityStats[2],
      leadsLast24h: activityStats[3],
      conversationsLast24h: activityStats[4],
      appointmentsLast24h: activityStats[5]
    },
    leadStatusBreakdown,
    messageDirectionBreakdown,
    recentLeads24h: latestLeads.map((lead) => ({
      id: lead.id,
      status: lead.status,
      companyId: lead.companyId,
      createdAt: lead.createdAt.toISOString()
    })),
    recentMessages24h: latestMessages.map((message) => ({
      id: message.id,
      direction: message.direction,
      companyId: message.companyId,
      createdAt: message.createdAt.toISOString()
    })),
    eventTrends: {
      topEventsLast24h
    },
    recentEvents24h,
    workerHeartbeat,
    queueHealth,
    missingRequiredEnv,
    checks: {
      database,
      redis,
      appBaseUrl: appBaseUrlCheck(env),
      telnyxApiKey: telnyxApiKeyCheck(env),
      telnyxFromNumber: telnyxFromNumberCheck(env),
      telnyxConnection,
      telnyxWebhookVerification: telnyxWebhookVerificationStatus,
      telnyxCompanyRouting: telnyxRoutingStatus,
      internalApiKey: internalApiKeyCheck(env),
      observability: observabilityCheck(sentryDsnSet),
      notifications: notificationCheck(notifications),
      workerHeartbeat: workerHeartbeatCheck(workerHeartbeat)
    }
  };
}

export async function getRuntimeHealthProbe() {
  const env = envPresence();
  const notifications = notificationReadiness();
  const telnyxWebhookSecurity = getTelnyxWebhookSecurityConfig();
  const appBaseUrl = process.env.APP_BASE_URL?.trim() || null;
  const missingRequiredEnv = missingRequiredEnvVars(env);
  const [database, redis] = await Promise.all([checkDatabase(env.databaseUrlSet), checkRedis(env.redisUrlSet)]);
  const deployment = baseDeployment(env);
  const observability = observabilitySummary(env);
  const workerHeartbeat = env.redisUrlSet ? await readWorkerHeartbeatSummary() : emptyWorkerHeartbeatSummary();
  const checks = {
    database,
    redis,
    appBaseUrl: appBaseUrlCheck(env),
    telnyxApiKey: telnyxApiKeyCheck(env),
    telnyxFromNumber: telnyxFromNumberCheck(env),
    telnyxConnection: env.telnyxApiKeySet
      ? ({ status: 'ok', detail: 'Skipped in lightweight probe mode' } satisfies DependencyCheck)
      : telnyxApiKeyCheck(env),
    telnyxWebhookVerification: webhookVerificationCheck(telnyxWebhookSecurity),
    telnyxCompanyRouting: {
      status: 'missing_config',
      detail: 'Skipped in lightweight probe mode'
    } satisfies DependencyCheck,
    internalApiKey: internalApiKeyCheck(env),
    observability: observabilityCheck(observability.sentryDsnSet),
    notifications: notificationCheck(notifications),
    workerHeartbeat: env.redisUrlSet
      ? workerHeartbeatCheck(workerHeartbeat)
      : ({
          status: 'missing_config',
          detail: 'REDIS_URL is required for worker heartbeat visibility'
        } satisfies DependencyCheck)
  };
  const ok =
    missingRequiredEnv.length === 0 &&
    database.status === 'ok' &&
    redis.status === 'ok' &&
    checks.appBaseUrl.status === 'ok' &&
    checks.telnyxApiKey.status === 'ok' &&
    checks.telnyxFromNumber.status === 'ok' &&
    checks.internalApiKey.status === 'ok';

  return {
    ok,
    service: 'fixyourleads-core',
    timestamp: new Date().toISOString(),
    deployment,
    observability,
    env,
    telnyx: {
      companiesTotal: 0,
      companiesWithRouting: 0,
      companiesMissingRouting: 0,
      companiesMissingNotification: 0,
      topRoutingGaps: [],
      multiNumberCompanies: [],
      routingConflicts: [],
      apiStatus: checks.telnyxConnection.status,
      apiStatusCode: null,
      apiRequestId: null,
      apiDetail: checks.telnyxConnection.detail || null,
      webhookUrl: appBaseUrl ? new URL('/api/webhooks/telnyx', appBaseUrl).toString() : null,
      signatureVerificationEnabled: telnyxWebhookSecurity.verificationEnabled,
      publicKeySet: telnyxWebhookSecurity.publicKeySet,
      signatureMaxAgeSeconds: telnyxWebhookSecurity.timestampToleranceSeconds
    },
    volume: {
      companies: 0,
      leads: 0,
      conversations: 0,
      appointments: 0,
      messages: 0,
      events: 0,
      eventsLast24h: 0,
      messagesLast24h: 0,
      upcomingAppointments: 0,
      leadsLast24h: 0,
      conversationsLast24h: 0,
      appointmentsLast24h: 0
    },
    leadStatusBreakdown: [],
    messageDirectionBreakdown: [],
    recentLeads24h: [],
    recentMessages24h: [],
    eventTrends: {
      topEventsLast24h: []
    },
    recentEvents24h: [],
    workerHeartbeat,
    queueHealth: [],
    missingRequiredEnv,
    checks
  };
}
