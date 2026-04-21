import { db } from '@/lib/db';
import { notificationReadiness } from '@/lib/notifications';
import { getRedis } from '@/lib/redis';
import { envPresence, missingRequiredEnvVars } from '@/lib/runtime-safe';

type CheckStatus = 'ok' | 'missing_config' | 'error';

type DependencyCheck = {
  status: CheckStatus;
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

export async function getRuntimeHealth() {
  const env = envPresence();
  const notifications = notificationReadiness();
  const sentryDsnSet = hasConfiguredEnv('SENTRY_DSN') || hasConfiguredEnv('NEXT_PUBLIC_SENTRY_DSN');
  const deployment = {
    nodeEnv: env.nodeEnv,
    serviceName: process.env.RAILWAY_SERVICE_NAME || 'fixyourleads-core',
    environmentName:
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'unknown',
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
    commitSha:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      null,
    uptimeSeconds: Math.round(process.uptime())
  };
  const [database, redis] = await Promise.all([
    checkDatabase(env.databaseUrlSet),
    checkRedis(env.redisUrlSet)
  ]);

  const missingRequiredEnv = missingRequiredEnvVars(env);
  const ok =
    missingRequiredEnv.length === 0 &&
    database.status === 'ok' &&
    redis.status === 'ok';

  return {
    ok,
    service: 'fixyourleads-core',
    timestamp: new Date().toISOString(),
    deployment,
    observability: {
      structuredRuntimeLogs: true,
      sentryDsnSet,
      sentryEnvironment:
        process.env.SENTRY_ENVIRONMENT ||
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
        env.nodeEnv ||
        null
    },
    env,
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
