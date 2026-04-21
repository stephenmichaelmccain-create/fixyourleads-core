type RuntimeErrorSource = 'uncaught_exception' | 'unhandled_rejection';

function deploymentMeta() {
  return {
    service: process.env.RAILWAY_SERVICE_NAME || 'fixyourleads-core',
    environment:
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'unknown',
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
    commitSha:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      null,
    sentryConfigured: Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
  };
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null
    };
  }

  return {
    name: 'NonError',
    message: typeof error === 'string' ? error : JSON.stringify(error),
    stack: null
  };
}

function logRuntimeEvent(level: 'info' | 'error', event: string, payload: Record<string, unknown>) {
  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...deploymentMeta(),
    ...payload
  };

  const message = JSON.stringify(entry);

  if (level === 'error') {
    console.error(message);
    return;
  }

  console.info(message);
}

function onRuntimeError(source: RuntimeErrorSource, error: unknown) {
  logRuntimeEvent('error', 'runtime_exception', {
    source,
    error: normalizeError(error)
  });
}

let registered = false;

export async function register() {
  if (registered) {
    return;
  }

  registered = true;

  logRuntimeEvent('info', 'runtime_boot', {
    uptimeSeconds: Math.round(process.uptime())
  });

  process.on('unhandledRejection', (reason) => {
    onRuntimeError('unhandled_rejection', reason);
  });

  process.on('uncaughtExceptionMonitor', (error) => {
    onRuntimeError('uncaught_exception', error);
  });
}
