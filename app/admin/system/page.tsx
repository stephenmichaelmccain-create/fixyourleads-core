import { LayoutShell } from '@/app/components/LayoutShell';
import { getRuntimeHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

type RuntimeHealth = Awaited<ReturnType<typeof getRuntimeHealth>>;
type CheckKey = keyof RuntimeHealth['checks'];

function checkSummary(health: RuntimeHealth) {
  if (health.ok) {
    return {
      tone: 'ok' as const,
      title: 'All systems look healthy.',
      body: 'You should not need to think about the plumbing right now.'
    };
  }

  return {
    tone: 'warn' as const,
    title: 'Something needs a technical look.',
    body: 'One or more runtime checks need attention before you trust the system fully.'
  };
}

const priorityCheckCards: Array<{
  key: CheckKey;
  title: string;
  href: string;
  action: string;
}> = [
  {
    key: 'telnyxWebhookVerification',
    title: 'Telnyx webhook signatures',
    href: '/diagnostics/workflows',
    action: 'Open workflow map'
  },
  {
    key: 'notifications',
    title: 'Booking email delivery',
    href: '/admin/system',
    action: 'Open system checks'
  },
  {
    key: 'observability',
    title: 'Error monitoring',
    href: '/admin/system',
    action: 'Open system checks'
  },
  {
    key: 'telnyxCompanyRouting',
    title: 'Client routing coverage',
    href: '/clients',
    action: 'Open clients'
  },
  {
    key: 'workerHeartbeat',
    title: 'Worker heartbeat',
    href: '/diagnostics/queues',
    action: 'Open queue health'
  }
];

const systemSettingsPages = [
  {
    href: '#checks',
    title: 'System checks',
    body: 'Runtime readiness, deploy info, and which checks are failing right now.',
    action: 'Open checks'
  },
  {
    href: '/diagnostics/queues',
    title: 'Queue health',
    body: 'Worker heartbeat, failed jobs, and queue backlog.',
    action: 'Open queues'
  },
  {
    href: '/diagnostics/workflows',
    title: 'Workflow map',
    body: 'How intake, Telnyx, booking, and the app tie together.',
    action: 'Open map'
  },
  {
    href: '/admin/activity',
    title: 'Activity log',
    body: 'Operator event feed: messages, bookings, intake, and worker actions.',
    action: 'Open activity'
  },
  {
    href: '/clients/intake',
    title: 'Client intake queue',
    body: 'New workspaces waiting on setup, routing, and booking hookup.',
    action: 'Open intake'
  }
] as const;

function priorityCardDetail(health: RuntimeHealth, key: CheckKey) {
  if (key === 'telnyxCompanyRouting' && health.telnyx.companiesMissingRouting > 0) {
    return `${health.telnyx.companiesMissingRouting} client workspace${
      health.telnyx.companiesMissingRouting === 1 ? '' : 's'
    } still missing inbound routing.`;
  }

  if (key === 'observability' && !health.observability.sentryDsnSet) {
    return 'Sentry is wired but the DSN is still missing, so runtime issues are relying on Railway logs.';
  }

  return health.checks[key].detail || 'Needs attention.';
}

function priorityCards(health: RuntimeHealth) {
  return priorityCheckCards.filter(({ key }) => health.checks[key].status !== 'ok');
}

export default async function AdminSystemPage() {
  const health = await getRuntimeHealth();
  const summary = checkSummary(health);
  const failingChecks = Object.entries(health.checks).filter(([, check]) => check.status !== 'ok');
  const activePriorityCards = priorityCards(health);

  return (
    <LayoutShell
      title="Settings"
      description="Health checks and system settings."
      section="system"
      hidePageHeader
    >
      <section className={`panel panel-stack ${summary.tone === 'ok' ? 'panel-success' : 'panel-attention'}`}>
        <div className="inline-row">
          <span className={`status-dot ${summary.tone}`} />
          <strong>{summary.title}</strong>
        </div>
        <p className="page-copy">{summary.body}</p>
        <div className="tiny-muted">Last checked: {new Date(health.timestamp).toLocaleString()}</div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Settings</div>
            <h2 className="section-title">Everything linked from one place.</h2>
          </div>
        </div>

        <div className="surface-link-grid">
          {systemSettingsPages.map((page) => (
            <a key={page.href} className="surface-link-card" href={page.href}>
              <span className="metric-label">Settings</span>
              <strong className="section-title">{page.title}</strong>
              <span className="text-muted">{page.body}</span>
              <span className="tiny-muted">{page.action}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Priority gaps</div>
            <h2 className="section-title">The current blockers keeping the platform from being boring.</h2>
          </div>
        </div>

        {activePriorityCards.length === 0 ? (
          <div className="empty-state">No urgent platform blockers are showing up in the current health checks.</div>
        ) : (
          <div className="surface-link-grid">
            {activePriorityCards.map((card) => (
              <a key={card.key} className="surface-link-card" href={card.href}>
                <span className="inline-row">
                  <span className={`status-dot ${health.checks[card.key].status === 'error' ? 'error' : 'warn'}`} />
                  <span className="metric-label">Needs attention</span>
                </span>
                <strong className="section-title">{card.title}</strong>
                <span className="text-muted">{priorityCardDetail(health, card.key)}</span>
                <span className="tiny-muted">{card.action}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="panel panel-stack" id="checks">
        <details>
          <summary className="form-title">System check details</summary>
          <div className="page-stack" style={{ marginTop: 16 }}>
            <div className="key-value-grid">
              <div className="key-value-card">
                <span className="key-value-label">Service</span>
                <span>{health.service}</span>
              </div>
              <div className="key-value-card">
                <span className="key-value-label">Environment</span>
                <span>{health.deployment.environmentName}</span>
              </div>
              <div className="key-value-card">
                <span className="key-value-label">Commit</span>
                <span>{health.deployment.commitSha || 'unknown'}</span>
              </div>
              <div className="key-value-card">
                <span className="key-value-label">Uptime</span>
                <span>{health.deployment.uptimeSeconds}s</span>
              </div>
            </div>

            <div className="panel panel-stack">
              <div className="metric-label">Checks</div>
              {failingChecks.length === 0 ? (
                <div className="text-muted">All runtime checks are currently green.</div>
              ) : (
                <ul className="status-list">
                  {failingChecks.map(([key, check]) => (
                    <li key={key} className="status-item">
                      <span className={`status-dot ${check.status === 'error' ? 'error' : 'warn'}`} />
                      <div className="panel-stack" style={{ gap: 4 }}>
                        <strong>{key}</strong>
                        <span className="tiny-muted">{check.detail || check.status}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="inline-actions">
              <a className="button-secondary" href="/diagnostics/queues">
                Queue health
              </a>
              <a className="button-secondary" href="/diagnostics/workflows">
                Workflow map
              </a>
            </div>
          </div>
        </details>
      </section>
    </LayoutShell>
  );
}
