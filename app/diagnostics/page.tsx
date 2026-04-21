import { LayoutShell } from '@/app/components/LayoutShell';
import { getRuntimeHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

function statusText(status: string) {
  if (status === 'ok') {
    return 'ok';
  }

  if (status === 'missing_config') {
    return 'missing config';
  }

  return 'error';
}

export default async function DiagnosticsPage() {
  const health = await getRuntimeHealth();
  const env = health.env;

  return (
    <LayoutShell title="Diagnostics">
      <p>
        <strong>Overall readiness:</strong> {health.ok ? 'ready' : 'not ready'}
      </p>

      <ul>
        <li>NODE_ENV: {env.nodeEnv || 'unset'}</li>
        <li>APP_BASE_URL: {env.appBaseUrlSet ? 'set' : 'missing'}</li>
        <li>DATABASE_URL: {env.databaseUrlSet ? 'set' : 'missing'}</li>
        <li>REDIS_URL: {env.redisUrlSet ? 'set' : 'missing'}</li>
        <li>TELNYX_API_KEY: {env.telnyxApiKeySet ? 'set' : 'missing'}</li>
        <li>TELNYX_FROM_NUMBER: {env.telnyxFromNumberSet ? 'set' : 'missing'}</li>
        <li>INTERNAL_API_KEY: {env.internalApiKeySet ? 'set' : 'missing'}</li>
        <li>SMTP_USER: {env.smtpUserSet ? 'set' : 'missing (optional)'}</li>
        <li>SMTP_PASSWORD: {env.smtpPasswordSet ? 'set' : 'missing (optional)'}</li>
      </ul>

      <p>Dependency checks:</p>
      <ul>
        <li>Database: {statusText(health.checks.database.status)}{health.checks.database.detail ? ` (${health.checks.database.detail})` : ''}</li>
        <li>Redis: {statusText(health.checks.redis.status)}{health.checks.redis.detail ? ` (${health.checks.redis.detail})` : ''}</li>
        <li>APP_BASE_URL: {statusText(health.checks.appBaseUrl.status)}{health.checks.appBaseUrl.detail ? ` (${health.checks.appBaseUrl.detail})` : ''}</li>
        <li>TELNYX_API_KEY: {statusText(health.checks.telnyxApiKey.status)}{health.checks.telnyxApiKey.detail ? ` (${health.checks.telnyxApiKey.detail})` : ''}</li>
        <li>TELNYX_FROM_NUMBER: {statusText(health.checks.telnyxFromNumber.status)}{health.checks.telnyxFromNumber.detail ? ` (${health.checks.telnyxFromNumber.detail})` : ''}</li>
        <li>INTERNAL_API_KEY: {statusText(health.checks.internalApiKey.status)}{health.checks.internalApiKey.detail ? ` (${health.checks.internalApiKey.detail})` : ''}</li>
        <li>Booking notifications: {statusText(health.checks.notifications.status)}{health.checks.notifications.detail ? ` (${health.checks.notifications.detail})` : ''}</li>
      </ul>

      {health.missingRequiredEnv.length > 0 && (
        <>
          <p>Missing required env vars:</p>
          <ul>
            {health.missingRequiredEnv.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </>
      )}
    </LayoutShell>
  );
}
