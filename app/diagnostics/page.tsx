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

function shortDateString(value: string) {
  if (!value) {
    return 'unknown';
  }

  return new Date(value).toLocaleString();
}

export default async function DiagnosticsPage() {
  const health = await getRuntimeHealth();
  const env = health.env;
  const lastUpdated = new Date(health.timestamp);
  type HealthCheck = { status: string; detail?: string | null };
  const missingRequiredEnv = health.missingRequiredEnv ?? [];
  const failingChecks = (Object.values(health.checks) as HealthCheck[]).filter((check) => check.status !== 'ok');
  const queueIssues = health.queueHealth.filter((queue) => queue.status !== 'ok');

  return (
    <LayoutShell
      title="Diagnostics"
      description="Use this page to verify the operational truth: env wiring, dependency health, and whether the live booking and notification paths are actually configured."
      section="diagnostics"
    >
      <div className="panel-grid">
        <section className={`panel panel-stack ${health.ok ? 'panel-success' : 'panel-attention'}`}>
          <div className="metric-label">Overall readiness</div>
          <h2 className="section-title section-title-large">{health.ok ? 'Ready to operate' : 'Needs attention'}</h2>
          <p className="page-copy">
            The product should stay lean, but it still needs honest runtime checks. This view is the fastest way to know whether the
            system can safely run live outreach and booking flows.
          </p>
          <div className="action-cluster">
            <span className={`readiness-pill ${health.ok ? 'is-ready' : 'is-warn'}`}>{health.ok ? 'All clear' : 'Action needed'}</span>
            <span className={`readiness-pill ${missingRequiredEnv.length === 0 ? 'is-ready' : 'is-warn'}`}>
              {missingRequiredEnv.length === 0 ? 'Required env set' : `${missingRequiredEnv.length} required env missing`}
            </span>
            <span className={`readiness-pill ${failingChecks.length === 0 ? 'is-ready' : 'is-warn'}`}>
              {failingChecks.length === 0 ? 'Checks passing' : `${failingChecks.length} checks failing`}
            </span>
            <span className={`readiness-pill ${queueIssues.length === 0 ? 'is-ready' : 'is-warn'}`}>
              {queueIssues.length === 0 ? 'Queues ok' : `${queueIssues.length} queue issue${queueIssues.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {missingRequiredEnv.length > 0 ? (
            <div className="tiny-muted">
              Missing required env: {missingRequiredEnv.slice(0, 4).join(', ')}
              {missingRequiredEnv.length > 4 ? ` +${missingRequiredEnv.length - 4} more` : ''}
            </div>
          ) : null}
          {!health.ok ? (
            <div className="inline-actions">
              <a className="button-secondary" href="#dependency-checks">
                Dependency checks
              </a>
              {missingRequiredEnv.length > 0 ? (
                <a className="button-secondary" href="#missing-required-env">
                  Missing env
                </a>
              ) : null}
              <a className="button-ghost" href="#telnyx-webhook">
                Telnyx webhook
              </a>
            </div>
          ) : null}
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Runtime snapshot</div>
          <div className="key-value-grid">
            <div className="key-value-card">
              <span className="key-value-label">Health check at</span>
              <span>{lastUpdated.toLocaleString()}</span>
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Service</span>
              <span>{health.service}</span>
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Uptime</span>
              <span>{`${health.deployment.uptimeSeconds}s`}</span>
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Node</span>
              <span>{health.deployment.nodeEnv || 'unset'}</span>
            </div>
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Workflow visibility</div>
          <h2 className="section-title">See how the live system is wired</h2>
          <p className="page-copy">
            Open the workflow map to see the real routes, workers, data records, and external systems behind lead intake, messaging,
            booking, and health checks.
          </p>
          <div className="inline-actions">
            <a className="button-secondary" href="/diagnostics/workflows">
              Open workflow map
            </a>
            <a className="button-ghost" href="/clients">
              Open clients
            </a>
          </div>
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
            <div className="key-value-card"><span className="key-value-label">TELNYX_VERIFY_SIGNATURES</span>{env.telnyxVerifySignaturesEnabled ? 'enabled' : 'disabled'}</div>
            <div className="key-value-card"><span className="key-value-label">TELNYX_PUBLIC_KEY</span>{env.telnyxPublicKeySet ? 'set' : 'missing'}</div>
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
        <div className="metric-label">Data footprint</div>
        <div className="key-value-grid">
          <div className="key-value-card"><span className="key-value-label">Companies</span>{health.volume.companies}</div>
          <div className="key-value-card"><span className="key-value-label">Leads</span>{health.volume.leads}</div>
          <div className="key-value-card"><span className="key-value-label">Conversations</span>{health.volume.conversations}</div>
          <div className="key-value-card"><span className="key-value-label">Appointments</span>{health.volume.appointments}</div>
          <div className="key-value-card"><span className="key-value-label">Messages</span>{health.volume.messages}</div>
          <div className="key-value-card"><span className="key-value-label">Events</span>{health.volume.events}</div>
          <div className="key-value-card"><span className="key-value-label">Upcoming bookings</span>{health.volume.upcomingAppointments}</div>
          <div className="key-value-card"><span className="key-value-label">Events last 24h</span>{health.volume.eventsLast24h}</div>
          <div className="key-value-card"><span className="key-value-label">Messages last 24h</span>{health.volume.messagesLast24h}</div>
          <div className="key-value-card"><span className="key-value-label">Leads last 24h</span>{health.volume.leadsLast24h}</div>
          <div className="key-value-card"><span className="key-value-label">Conversations last 24h</span>{health.volume.conversationsLast24h}</div>
          <div className="key-value-card"><span className="key-value-label">Appointments last 24h</span>{health.volume.appointmentsLast24h}</div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Lead + messaging pipeline</div>
        <div className="key-value-grid">
          {health.leadStatusBreakdown.length === 0 ? (
            <div className="key-value-card">
              <span className="key-value-label">Lead statuses</span>No leads yet
            </div>
          ) : (
            health.leadStatusBreakdown.map((item) => (
              <div key={item.status} className="key-value-card">
                <span className="key-value-label">{`Lead ${item.status}`}</span>
                {item.count}
              </div>
            ))
          )}
          {health.messageDirectionBreakdown.map((item) => (
            <div key={item.direction} className="key-value-card">
              <span className="key-value-label">{`Messages ${item.direction}`}</span>
              {item.count}
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Queue health</div>
        <ul className="status-list">
          {health.queueHealth.map((queue) => (
            <li key={queue.name} className="status-item">
              <span className="status-label">
                <span className={`status-dot ${statusClass(queue.status)}`}></span>
                {queue.name}
              </span>
              <span className="text-muted">
                {statusText(queue.status)}
                {queue.detail ? ` (${queue.detail})` : ''}
              </span>
            </li>
          ))}
          {health.queueHealth.map((queue) =>
            queue.counts ? (
              <li key={`${queue.name}-counts`} className="status-item">
                <span className="status-label">Waiting/active</span>
                <span className="text-muted">
                  {`${queue.counts.waiting} waiting · ${queue.counts.active} active · ${queue.counts.delayed} delayed · ${queue.counts.failed} failed · ${queue.counts.stalled} stalled`}
                </span>
              </li>
            ) : null
          )}
          {health.queueHealth.flatMap((queue) =>
            (queue.failedJobs || []).map((job) => (
              <li key={`${queue.name}-failed-${job.id}`} className="status-item">
                <span className="status-label">{`${queue.name} failed job ${job.id}`}</span>
                <span className="text-muted">
                  {shortDateString(job.failedAt || '')} — attempts {job.attemptsMade} — {job.failedReason || 'no reason logged'}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Recent operations</div>
        <div className="status-label">Top events in last 24h</div>
        <ul className="list-clean">
          {health.eventTrends.topEventsLast24h.length === 0 ? (
            <li>No events in the last 24h yet.</li>
          ) : (
            health.eventTrends.topEventsLast24h.map((entry) => (
              <li key={entry.eventType}>
                {entry.eventType}: {entry.count}
              </li>
            ))
          )}
        </ul>
        <div className="status-label">Latest events</div>
        <ul className="list-clean">
          {health.recentEvents24h.length === 0 ? (
            <li>No recent event log entries.</li>
          ) : (
            health.recentEvents24h.map((entry) => (
              <li key={entry.id}>
                {shortDateString(entry.createdAt)} — {entry.eventType} (company {entry.companyId})
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Latest lead/message activity</div>
        <div className="status-label">Recent leads</div>
        <ul className="list-clean">
          {health.recentLeads24h.length === 0 ? (
            <li>No leads yet.</li>
          ) : (
            health.recentLeads24h.map((entry) => (
              <li key={entry.id}>
                {shortDateString(entry.createdAt)} — lead {entry.status} (company {entry.companyId})
              </li>
            ))
          )}
        </ul>
        <div className="status-label">Recent messages</div>
        <ul className="list-clean">
          {health.recentMessages24h.length === 0 ? (
            <li>No messages yet.</li>
          ) : (
            health.recentMessages24h.map((entry) => (
              <li key={entry.id}>
                {shortDateString(entry.createdAt)} — {entry.direction} (company {entry.companyId})
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Telnyx routing readiness</div>
        <div className="key-value-grid">
          <div className="key-value-card">
            <span className="key-value-label">Companies</span>
            {health.telnyx.companiesTotal}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Routing ready</span>
            {health.telnyx.companiesWithRouting}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Missing routing</span>
            {health.telnyx.companiesMissingRouting}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Missing clinic email</span>
            {health.telnyx.companiesMissingNotification}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Multi-number clinics</span>
            {health.telnyx.multiNumberCompanies.length}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Routing conflicts</span>
            {health.telnyx.routingConflicts.length}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Webhook URL</span>
            {health.telnyx.webhookUrl || 'needs APP_BASE_URL'}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Signature mode</span>
            {health.telnyx.signatureVerificationEnabled ? 'strict' : 'not enforced'}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Replay window</span>
            {`${health.telnyx.signatureMaxAgeSeconds}s`}
          </div>
        </div>
      </section>

        <section className="panel panel-stack">
          <div className="metric-label">External connectivity</div>
          <div className="key-value-grid">
            <div className="key-value-card">
              <span className="key-value-label">Telnyx API</span>
              {health.telnyx.apiStatus} ({health.telnyx.apiStatusCode || 'n/a'})
            </div>
            {health.telnyx.apiRequestId ? (
              <div className="key-value-card">
                <span className="key-value-label">Telnyx request-id</span>
                {health.telnyx.apiRequestId}
              </div>
            ) : null}
          </div>
          <div className="text-muted">{health.telnyx.apiDetail || 'No Telnyx API probe detail returned.'}</div>
        </section>

      <section className="panel panel-stack">
        <div className="metric-label">Routing gaps</div>
        {health.telnyx.topRoutingGaps.length === 0 ? (
          <p className="text-muted">No routing gaps detected.</p>
        ) : (
          <ul className="list-clean">
            {health.telnyx.topRoutingGaps.map((entry: { id: string; name: string; notificationEmailSet: boolean }) => (
              <li key={entry.id}>
                {entry.name} ({entry.id}) — notification email set: {entry.notificationEmailSet ? 'yes' : 'no'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Inbound number overlap</div>
        {health.telnyx.routingConflicts.length === 0 ? (
          <p className="text-muted">No shared inbound numbers across clinics found.</p>
        ) : (
          <ul className="list-clean">
            {health.telnyx.routingConflicts.map((entry) => (
              <li key={entry.number}>
                <strong>{entry.number}</strong> used by {entry.companies.length} clinics ({entry.companies.map((clinic) => clinic.name).join(', ')})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="telnyx-webhook" className="panel panel-stack">
        <div className="metric-label">Telnyx webhook setup</div>
        <ul className="list-clean">
          <li>Point the Telnyx messaging profile or number webhook at <code>{health.telnyx.webhookUrl || '/api/webhooks/telnyx'}</code>.</li>
          <li>
            {health.telnyx.signatureVerificationEnabled
              ? 'Strict signature verification is on. Telnyx requests older than the replay window will be rejected.'
              : 'Signature verification is still off. Enable TELNYX_VERIFY_SIGNATURES before relying on full live inbound traffic.'}
          </li>
          <li>
            {health.telnyx.publicKeySet
              ? 'TELNYX_PUBLIC_KEY is present, so strict verification can validate Ed25519 signatures.'
              : 'TELNYX_PUBLIC_KEY is still missing. Add it before turning strict verification on.'}
          </li>
        </ul>
      </section>

      <section id="dependency-checks" className="panel panel-stack">
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
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.telnyxConnection.status)}`}></span>Telnyx API reachability</span>
            <span className="text-muted">
              {statusText(health.checks.telnyxConnection.status)}
              {health.checks.telnyxConnection.detail ? ` (${health.checks.telnyxConnection.detail})` : ''}
            </span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.telnyxWebhookVerification.status)}`}></span>Telnyx webhook verification</span>
            <span className="text-muted">{statusText(health.checks.telnyxWebhookVerification.status)}{health.checks.telnyxWebhookVerification.detail ? ` (${health.checks.telnyxWebhookVerification.detail})` : ''}</span>
          </li>
          <li className="status-item">
            <span className="status-label"><span className={`status-dot ${statusClass(health.checks.telnyxCompanyRouting.status)}`}></span>Company reply routing</span>
            <span className="text-muted">{statusText(health.checks.telnyxCompanyRouting.status)}{health.checks.telnyxCompanyRouting.detail ? ` (${health.checks.telnyxCompanyRouting.detail})` : ''}</span>
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

      {missingRequiredEnv.length > 0 && (
        <section id="missing-required-env" className="panel panel-stack">
          <div className="metric-label">Missing required env vars</div>
          <ul className="list-clean">
            {missingRequiredEnv.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      )}
    </LayoutShell>
  );
}
