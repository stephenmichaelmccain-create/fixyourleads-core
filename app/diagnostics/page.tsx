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

function statusClass(status: string) {
  if (status === 'ok') {
    return 'ok';
  }

  if (status === 'missing_config') {
    return 'warn';
  }

  return 'error';
}

export default async function DiagnosticsPage() {
  const health = await getRuntimeHealth();
  const env = health.env;

  return (
    <LayoutShell
      title="Diagnostics"
      description="Use this page to verify the operational truth: env wiring, dependency health, and whether the booking notification path is actually configured."
      section="diagnostics"
    >
      <div className="panel-grid">
        <section className={`panel panel-stack${health.ok ? '' : ''}`}>
          <div className="metric-label">Overall readiness</div>
          <h2 className="section-title section-title-large">{health.ok ? 'Ready to operate' : 'Needs attention'}</h2>
          <p className="page-copy">
            The product should stay lean, but it still needs honest runtime checks. This view is the fastest way to know whether the
            system can safely run outreach and booking flows.
          </p>
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Environment</div>
          <div className="key-value-grid">
            <div className="key-value-card"><span className="key-value-label">NODE_ENV</span>{env.nodeEnv || 'unset'}</div>
            <div className="key-value-card"><span className="key-value-label">APP_BASE_URL</span>{env.appBaseUrlSet ? 'set' : 'missing'}</div>
            <div className="key-value-card"><span className="key-value-label">DATABASE_URL</span>{env.databaseUrlSet ? 'set' : 'missing'}</div>
            <div className="key-value-card"><span className="key-value-label">REDIS_URL</span>{env.redisUrlSet ? 'set' : 'missing'}</div>
            <div className="key-value-card"><span className="key-value-label">TELNYX_API_KEY</span>{env.telnyxApiKeySet ? 'set' : 'missing'}</div>
            <div className="key-value-card"><span className="key-value-label">TELNYX_FROM_NUMBER</span>{env.telnyxFromNumberSet ? 'set' : 'missing'}</div>
            <div className="key-value-card"><span className="key-value-label">INTERNAL_API_KEY</span>{env.internalApiKeySet ? 'set' : 'missing'}</div>
            <div className="key-value-card"><span className="key-value-label">SENTRY_DSN</span>{health.observability.sentryDsnSet ? 'set' : 'missing (recommended)'}</div>
            <div className="key-value-card"><span className="key-value-label">SMTP_USER</span>{env.smtpUserSet ? 'set' : 'missing (optional)'}</div>
            <div className="key-value-card"><span className="key-value-label">SMTP_PASSWORD</span>{env.smtpPasswordSet ? 'set' : 'missing (optional)'}</div>
          </div>
        </section>
      </div>

      <section className="panel panel-stack">
        <div className="metric-label">Deployment</div>
        <div className="key-value-grid">
          <div className="key-value-card"><span className="key-value-label">Service</span>{health.deployment.serviceName}</div>
          <div className="key-value-card"><span className="key-value-label">Environment</span>{health.deployment.environmentName}</div>
          <div className="key-value-card"><span className="key-value-label">Deployment ID</span>{health.deployment.deploymentId || 'unknown'}</div>
          <div className="key-value-card"><span className="key-value-label">Commit</span>{health.deployment.commitSha || 'unknown'}</div>
          <div className="key-value-card"><span className="key-value-label">Uptime</span>{`${health.deployment.uptimeSeconds}s`}</div>
          <div className="key-value-card"><span className="key-value-label">Sentry env</span>{health.observability.sentryEnvironment || 'unset'}</div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Dependency checks</div>
        <ul className="status-list">
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.database.status)}`}></span>Database</span>
            <span className="text-muted">{statusText(health.checks.database.status)}{health.checks.database.detail ? ` (${health.checks.database.detail})` : ''}</span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.redis.status)}`}></span>Redis</span>
            <span className="text-muted">{statusText(health.checks.redis.status)}{health.checks.redis.detail ? ` (${health.checks.redis.detail})` : ''}</span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.appBaseUrl.status)}`}></span>APP_BASE_URL</span>
            <span className="text-muted">{statusText(health.checks.appBaseUrl.status)}{health.checks.appBaseUrl.detail ? ` (${health.checks.appBaseUrl.detail})` : ''}</span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.telnyxApiKey.status)}`}></span>TELNYX_API_KEY</span>
            <span className="text-muted">{statusText(health.checks.telnyxApiKey.status)}{health.checks.telnyxApiKey.detail ? ` (${health.checks.telnyxApiKey.detail})` : ''}</span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.telnyxFromNumber.status)}`}></span>TELNYX_FROM_NUMBER</span>
            <span className="text-muted">{statusText(health.checks.telnyxFromNumber.status)}{health.checks.telnyxFromNumber.detail ? ` (${health.checks.telnyxFromNumber.detail})` : ''}</span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.internalApiKey.status)}`}></span>INTERNAL_API_KEY</span>
            <span className="text-muted">{statusText(health.checks.internalApiKey.status)}{health.checks.internalApiKey.detail ? ` (${health.checks.internalApiKey.detail})` : ''}</span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.observability.status)}`}></span>Observability</span>
            <span className="text-muted">{statusText(health.checks.observability.status)}{health.checks.observability.detail ? ` (${health.checks.observability.detail})` : ''}</span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.notifications.status)}`}></span>Booking notifications</span>
            <span className="text-muted">{statusText(health.checks.notifications.status)}{health.checks.notifications.detail ? ` (${health.checks.notifications.detail})` : ''}</span>
          </li>
        </ul>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Lean guardrails</div>
        <ul className="list-clean">
          <li>`/api/health` now returns `503` when required runtime checks fail, so Railway healthchecks can fail honestly.</li>
          <li>Server boot, unhandled promise rejections, and uncaught exceptions now emit structured JSON into Railway logs.</li>
          <li>Sentry stays optional, but this page now tells you clearly whether its DSN is wired.</li>
        </ul>
      </section>

      {health.missingRequiredEnv.length > 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">Missing required env vars</div>
          <ul className="list-clean">
            {health.missingRequiredEnv.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      )}
    </LayoutShell>
  );
}
