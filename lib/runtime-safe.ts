export const REQUIRED_RUNTIME_ENV_VARS = [
  'APP_BASE_URL',
  'DATABASE_URL',
  'REDIS_URL',
  'TELNYX_API_KEY',
  'TELNYX_FROM_NUMBER',
  'INTERNAL_API_KEY'
] as const;

function hasConfiguredEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

export function envPresence() {
  return {
    nodeEnv: process.env.NODE_ENV || null,
    appBaseUrlSet: hasConfiguredEnv('APP_BASE_URL'),
    databaseUrlSet: hasConfiguredEnv('DATABASE_URL'),
    redisUrlSet: hasConfiguredEnv('REDIS_URL'),
    telnyxApiKeySet: hasConfiguredEnv('TELNYX_API_KEY'),
    telnyxFromNumberSet: hasConfiguredEnv('TELNYX_FROM_NUMBER'),
    internalApiKeySet: hasConfiguredEnv('INTERNAL_API_KEY'),
    smtpUserSet: hasConfiguredEnv('SMTP_USER'),
    smtpPasswordSet: hasConfiguredEnv('SMTP_PASSWORD'),
    notificationFromSet: hasConfiguredEnv('NOTIFICATION_FROM_EMAIL') || hasConfiguredEnv('SMTP_USER')
  };
}

export function missingRequiredEnvVars(env = envPresence()) {
  const requiredStatus = {
    APP_BASE_URL: env.appBaseUrlSet,
    DATABASE_URL: env.databaseUrlSet,
    REDIS_URL: env.redisUrlSet,
    TELNYX_API_KEY: env.telnyxApiKeySet,
    TELNYX_FROM_NUMBER: env.telnyxFromNumberSet,
    INTERNAL_API_KEY: env.internalApiKeySet
  } satisfies Record<(typeof REQUIRED_RUNTIME_ENV_VARS)[number], boolean>;

  return REQUIRED_RUNTIME_ENV_VARS.filter((name) => !requiredStatus[name]);
}
