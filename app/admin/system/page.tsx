import { LayoutShell } from '@/app/components/LayoutShell';
import { getRuntimeHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

function checkSummary(health: Awaited<ReturnType<typeof getRuntimeHealth>>) {
  if (health.ok) {
    return {
      tone: 'ok' as const,
      title: 'All Systems Operational',
      body: 'All client phones and core services look healthy right now.'
    };
  }

  return {
    tone: 'warn' as const,
    title: 'Attention Needed',
    body: 'One or more runtime checks need a technical look before you trust the system fully.'
  };
}

export default async function AdminSystemPage() {
  const health = await getRuntimeHealth();
  const summary = checkSummary(health);
  const failingChecks = Object.entries(health.checks).filter(([, check]) => check.status !== 'ok');

  return (
    <LayoutShell
      title="System Status"
      description="A calm, honest system check. If this page is green, you should not need to think about the plumbing."
      section="system"
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
        <details>
          <summary className="form-title">Show technical details</summary>
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
                Queue detail
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
