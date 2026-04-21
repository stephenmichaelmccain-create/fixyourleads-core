export function envPresence() {
  return {
    nodeEnv: process.env.NODE_ENV || null,
    appBaseUrlSet: Boolean(process.env.APP_BASE_URL),
    databaseUrlSet: Boolean(process.env.DATABASE_URL),
    redisUrlSet: Boolean(process.env.REDIS_URL),
    telnyxApiKeySet: Boolean(process.env.TELNYX_API_KEY),
    telnyxFromNumberSet: Boolean(process.env.TELNYX_FROM_NUMBER),
    internalApiKeySet: Boolean(process.env.INTERNAL_API_KEY)
  };
}
