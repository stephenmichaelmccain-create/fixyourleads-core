import { LayoutShell } from '@/app/components/LayoutShell';
import { envPresence } from '@/lib/runtime-safe';

export default function DiagnosticsPage() {
  const env = envPresence();

  return (
    <LayoutShell title="Diagnostics">
      <ul>
        <li>NODE_ENV: {env.nodeEnv || 'unset'}</li>
        <li>APP_BASE_URL: {env.appBaseUrlSet ? 'set' : 'missing'}</li>
        <li>DATABASE_URL: {env.databaseUrlSet ? 'set' : 'missing'}</li>
        <li>REDIS_URL: {env.redisUrlSet ? 'set' : 'missing'}</li>
        <li>TELNYX_API_KEY: {env.telnyxApiKeySet ? 'set' : 'missing'}</li>
        <li>TELNYX_FROM_NUMBER: {env.telnyxFromNumberSet ? 'set' : 'missing'}</li>
        <li>INTERNAL_API_KEY: {env.internalApiKeySet ? 'set' : 'missing'}</li>
      </ul>
    </LayoutShell>
  );
}
