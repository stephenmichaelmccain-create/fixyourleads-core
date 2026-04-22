import { db } from '@/lib/db';
import { notificationReadiness } from '@/lib/notifications';
import { getBookingQueue, getLeadQueue, getMessageQueue } from '@/lib/queue';
import { getRedis } from '@/lib/redis';
import { envPresence, missingRequiredEnvVars } from '@/lib/runtime-safe';
import { getTelnyxWebhookSecurityConfig } from '@/lib/security';
import { checkTelnyxConnectivity } from '@/lib/telnyx';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';

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

async function checkMcpGatewayConnectivity(
  serverUrlSet: boolean,
  serverUrl: string | undefined,
  accessToken: string | undefined
): Promise<DependencyCheck> {
  if (!serverUrlSet || !serverUrl) {
    return {
      status: 'missing_config',
      detail: 'MCP server URL is not configured. Set MCP_SERVER_URL or OPENCLAW_MCP_URL.'
    };
  }

  if (!accessToken) {
    return {
      status: 'missing_config',
      detail: 'MCP URL is set, but MCP_ACCESS_TOKEN or OPENCLAW_MCP_TOKEN is missing.'
    };
  }

  const normalizeTrailingSlash = (value: string) => value.replace(/\/$/, '');
  const normalizedServerUrl = normalizeTrailingSlash(serverUrl);
  const candidateUrls = Array.from(new Set([normalizedServerUrl, `${normalizedServerUrl}/sse`]));
  const headers = {
    Authorization: `Bearer ${accessToken}`
  };
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 2_000);
  let lastErrorDetail: string | undefined;

  const evaluateStatus = (statusCode: number) => {
    const statusText = `${statusCode}`;
    if (statusCode === 401 || statusCode === 403) {
      return {
        status: 'error' as const,
        detail: `MCP gateway responded with ${statusText}; token is likely invalid.`
      };
    }

    if (statusCode === 404) {
      return {
        status: 'error' as const,
        detail: `MCP gateway returned ${statusText}; check endpoint path and protocol`
      };
    }

    if (statusCode >= 500) {
      return {
        status: 'error' as const,
        detail: `MCP gateway returned ${statusText}; server-side error`
      };
    }

    if (statusCode >= 400) {
      return {
        status: 'error' as const,
        detail: `MCP gateway returned ${statusText}; endpoint may require a different protocol method`
      };
    }

    return {
      status: 'ok' as const,
      detail: `MCP endpoint reachable (${statusCode})`
    };
  };

  try {
    for (const candidate of candidateUrls) {
      try {
        const response = await fetch(candidate, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
        const statusCode = response.status;
        const result = evaluateStatus(statusCode);

        if (result.status === 'ok' || statusCode === 405) {
          return {
            status: statusCode === 405 ? 'ok' : result.status,
            detail: `${result.detail} (tested ${candidate})`,
            statusCode
          };
        }

        lastErrorDetail = `${result.detail} (tested ${candidate})`;

        // Keep trying alternate endpoints if the first path is not found.
        if (statusCode !== 404) {
          return {
            ...result,
            statusCode
          } as DependencyCheck;
        }
      } catch {
        // Save generic transport error and keep trying alternate endpoints.
      }
    }

    return {
      status: 'error',
      detail: lastErrorDetail || 'MCP gateway not reachable from configured URLs'
    };
  } catch (error) {
    return {
      status: 'error',
      detail:
        error instanceof Error && error.name === 'AbortError'
          ? 'MCP gateway check timed out'
          : `MCP gateway check failed: ${error instanceof Error ? error.message : 'unknown error'}`
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getRuntimeHealth() {
  const env = envPresence();
  const notifications = notificationReadiness();
  const telnyxWebhookSecurity = getTelnyxWebhookSecurityConfig();
  const appBaseUrl = process.env.APP_BASE_URL?.trim() || null;
  const mcpServerUrl = readEnvValue(['MCP_SERVER_URL', 'OPENCLAW_MCP_URL']);
  const mcpAccessToken = readEnvValue(['MCP_ACCESS_TOKEN', 'OPENCLAW_MCP_TOKEN']);
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
    mcpGateway
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
    checkMcpGatewayConnectivity(env.openclawMcpUrlSet, mcpServerUrl, mcpAccessToken)
  ]);

  const deployment = {
    nodeEnv: env.nodeEnv,
    serviceName: process.env.RAILWAY_SERVICE_NAME || 'fixyourleads-core',
    environmentName:
      process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'unknown',
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    uptimeSeconds: Math.round(process.uptime())
  };

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
  const telnyxWebhookVerificationStatus =
    !telnyxWebhookSecurity.verificationEnabled
      ? ({
          status: 'missing_config',
          detail: `TELNYX_VERIFY_SIGNATURES is disabled; webhook authenticity is not enforced yet. Current timestamp tolerance is ${telnyxWebhookSecurity.timestampToleranceSeconds}s once enabled.`
        } satisfies DependencyCheck)
      : telnyxWebhookSecurity.publicKeySet
        ? ({
            status: 'ok',
            detail: `Webhook signature verification is enabled with a ${telnyxWebhookSecurity.timestampToleranceSeconds}s replay window`
          } satisfies DependencyCheck)
        : ({
            status: 'error',
            detail: 'TELNYX_VERIFY_SIGNATURES is enabled but TELNYX_PUBLIC_KEY is missing'
          } satisfies DependencyCheck);
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
    queueOk &&
    (mcpGateway.status !== 'error');

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
    mcp: {
      serverUrl: mcpServerUrl || null,
      tokenConfigured: env.openclawMcpTokenSet,
      connectivityStatus: mcpGateway.status,
      connectivityStatusCode: mcpGateway.statusCode || null,
      connectivityDetail: mcpGateway.detail || null
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
    queueHealth,
    missingRequiredEnv,
    checks: {
      database,
      redis,
      appBaseUrl: env.appBaseUrlSet
        ? ({ status: 'ok' } satisfies DependencyCheck)
        : ({
            status: 'missing_config',
            detail: 'APP_BASE_URL is missing'
          } satisfies DependencyCheck),
      telnyxApiKey: env.telnyxApiKeySet
        ? ({ status: 'ok' } satisfies DependencyCheck)
        : ({
            status: 'missing_config',
            detail: 'TELNYX_API_KEY is missing'
          } satisfies DependencyCheck),
      telnyxFromNumber: env.telnyxFromNumberSet
        ? ({ status: 'ok' } satisfies DependencyCheck)
        : ({
            status: 'missing_config',
            detail: 'TELNYX_FROM_NUMBER is missing'
          } satisfies DependencyCheck),
      telnyxConnection,
      telnyxWebhookVerification: telnyxWebhookVerificationStatus,
      telnyxCompanyRouting: telnyxRoutingStatus,
      openClawMcpServer: env.openclawMcpUrlSet
        ? ({ status: 'ok' } satisfies DependencyCheck)
        : ({
            status: 'missing_config',
            detail: 'OPENCLAW_MCP_URL or MCP_SERVER_URL is missing'
          } satisfies DependencyCheck),
      openClawMcpToken: env.openclawMcpTokenSet
        ? ({ status: 'ok' } satisfies DependencyCheck)
        : ({
            status: 'missing_config',
            detail: 'OPENCLAW_MCP_TOKEN or MCP_ACCESS_TOKEN is missing'
          } satisfies DependencyCheck),
      mcpGateway,
      internalApiKey: env.internalApiKeySet
        ? ({ status: 'ok' } satisfies DependencyCheck)
        : ({
            status: 'missing_config',
            detail: 'INTERNAL_API_KEY is missing'
          } satisfies DependencyCheck),
      observability: sentryDsnSet
        ? ({
            status: 'ok',
            detail: 'Sentry DSN is configured and structured runtime logs are enabled'
          } satisfies DependencyCheck)
        : ({
            status: 'missing_config',
            detail: 'SENTRY_DSN is optional, but recommended; runtime errors still land in Railway logs as structured JSON'
          } satisfies DependencyCheck),
      notifications:
        notifications.smtpUserSet && notifications.smtpPasswordSet
          ? ({ status: 'ok', detail: 'SMTP notification path configured' } satisfies DependencyCheck)
          : ({
              status: 'missing_config',
              detail: 'SMTP_USER and SMTP_PASSWORD are optional, but required for booking email notifications'
            } satisfies DependencyCheck)
    }
  };
}
