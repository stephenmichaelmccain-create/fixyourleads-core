import { LayoutShell } from '@/app/components/LayoutShell';
import { getRuntimeHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

function statusClass(status: string) {
  if (status === 'ok') {
    return 'ok';
  }

  if (status === 'missing_config') {
    return 'warn';
  }

  return 'error';
}

function statusText(status: string) {
  if (status === 'ok') {
    return 'ok';
  }

  if (status === 'missing_config') {
    return 'missing config';
  }

  return 'error';
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Not reported yet';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function queueMaxValue(health: Awaited<ReturnType<typeof getRuntimeHealth>>) {
  const numbers = health.queueHealth.flatMap((queue) =>
    queue.counts
      ? [
          queue.counts.waiting,
          queue.counts.active,
          queue.counts.delayed,
          queue.counts.completed,
          queue.counts.failed,
          queue.counts.stalled
        ]
      : []
  );

  return Math.max(1, ...numbers);
}

function barWidth(value: number, maxValue: number) {
  return `${Math.max(8, Math.round((value / maxValue) * 100))}%`;
}

export default async function QueueDiagnosticsPage() {
  const health = await getRuntimeHealth();
  const heartbeat = health.workerHeartbeat;
  const maxValue = queueMaxValue(health);

  return (
    <LayoutShell
      title="Queue and Heartbeat"
      description="See the worker queues, failed jobs, and the follow-up heartbeat sweep without touching production secrets."
      section="diagnostics"
    >
      <div className="metric-grid">
        <section className="metric-card panel-stack">
          <div className="metric-label">Worker heartbeat</div>
          <div className="metric-value">{health.checks.workerHeartbeat.status === 'ok' ? 'Live' : 'Needs attention'}</div>
          <div className="metric-copy">{health.checks.workerHeartbeat.detail || 'No heartbeat detail yet.'}</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Last seen</div>
          <div className="metric-value">{formatDateTime(heartbeat.lastSeenAt)}</div>
          <div className="metric-copy">The worker updates this every minute while it is alive.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Last follow-up sweep</div>
          <div className="metric-value">{formatDateTime(heartbeat.lastSweepAt)}</div>
          <div className="metric-copy">Current sweep runs every 5 minutes in safe observe-only mode.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Auto-send mode</div>
          <div className="metric-value">{heartbeat.autoSendEnabled ? 'On' : 'Off'}</div>
          <div className="metric-copy">No automated follow-up texts are sent from this heartbeat yet.</div>
        </section>
      </div>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Follow-up heartbeat</div>
            <h2 className="section-title">The timer keeps due prospect follow-up work visible.</h2>
          </div>
          <span className={`status-chip ${health.checks.workerHeartbeat.status === 'ok' ? '' : 'status-chip-attention'}`}>
            <span className={`status-dot ${statusClass(health.checks.workerHeartbeat.status)}`} />
            {statusText(health.checks.workerHeartbeat.status)}
          </span>
        </div>

        <div className="key-value-grid">
          <div className="key-value-card">
            <span className="key-value-label">Overdue prospects</span>
            {heartbeat.followUp.overdueCount}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Due today</span>
            {heartbeat.followUp.dueTodayCount}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Due next 7 days</span>
            {heartbeat.followUp.dueNext7Count}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Quiet hours</span>
            {`${heartbeat.quietHours.startHourLocal}:00-${heartbeat.quietHours.endHourLocal}:00 local`}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Frequency cap</span>
            {`${heartbeat.frequencyCapPerLeadPerWeek} touches per lead / week`}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Safety mode</span>
            Observe-only heartbeat
          </div>
        </div>

        <div className="panel panel-dark panel-stack">
          <div className="metric-label">Next due prospects</div>
          {heartbeat.followUp.sampleDue.length === 0 ? (
            <div className="empty-state">No due prospects are currently in the follow-up window.</div>
          ) : (
            <div className="record-grid">
              {heartbeat.followUp.sampleDue.map((prospect) => (
                <article key={prospect.id} className="record-card">
                  <div className="record-card-live-head">
                    <span className="status-chip status-chip-attention">
                      <span className="status-dot warn" />
                      {prospect.status}
                    </span>
                    <span className="tiny-muted">{formatDateTime(prospect.nextActionAt)}</span>
                  </div>
                  <div className="panel-stack">
                    <strong>{prospect.name}</strong>
                    <div className="text-muted">{prospect.city || 'City not set'}</div>
                  </div>
                  <div className="action-cluster">
                    <a className="button-ghost" href={`/leads?prospectId=${prospect.id}`}>
                      Open prospect
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Queue detail</div>
        <div className="record-grid">
          {health.queueHealth.map((queue) => (
            <article key={queue.name} className="record-card">
              <div className="record-card-live-head">
                <span className={`status-chip ${queue.status === 'error' ? 'status-chip-attention' : queue.status === 'missing_config' ? 'status-chip-muted' : ''}`}>
                  <span className={`status-dot ${statusClass(queue.status)}`} />
                  {queue.name}
                </span>
                <span className="tiny-muted">{statusText(queue.status)}</span>
              </div>

              {queue.counts ? (
                <div className="panel-stack">
                  {[
                    ['Waiting', queue.counts.waiting],
                    ['Active', queue.counts.active],
                    ['Delayed', queue.counts.delayed],
                    ['Completed', queue.counts.completed],
                    ['Failed', queue.counts.failed],
                    ['Stalled', queue.counts.stalled]
                  ].map(([label, value]) => (
                    <div key={label} className="panel-stack" style={{ gap: 6 }}>
                      <div className="inline-row justify-between">
                        <span className="key-value-label">{label}</span>
                        <strong>{value}</strong>
                      </div>
                      <div
                        style={{
                          height: 8,
                          width: '100%',
                          borderRadius: 999,
                          background: 'rgba(255,255,255,0.08)',
                          overflow: 'hidden'
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: barWidth(Number(value), maxValue),
                            borderRadius: 999,
                            background:
                              label === 'Failed'
                                ? 'linear-gradient(90deg, rgba(255, 122, 122, 0.9), rgba(255, 91, 91, 0.9))'
                                : label === 'Active'
                                  ? 'linear-gradient(90deg, rgba(160, 124, 255, 0.9), rgba(188, 108, 255, 0.9))'
                                  : 'linear-gradient(90deg, rgba(126, 200, 255, 0.9), rgba(86, 177, 255, 0.9))'
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted">{queue.detail || 'Queue counts not available.'}</div>
              )}

              {(queue.failedJobs || []).length > 0 ? (
                <div className="panel-stack">
                  <div className="metric-label">Recent failed jobs</div>
                  <div className="status-list">
                    {(queue.failedJobs || []).map((job) => (
                      <div key={job.id} className="status-item" style={{ alignItems: 'flex-start' }}>
                        <div className="panel-stack" style={{ gap: 6 }}>
                          <span className="status-label">
                            <span className="status-dot error" />
                            Job {job.id}
                          </span>
                          <span className="tiny-muted">
                            attempts {job.attemptsMade} · {job.failedAt ? formatDateTime(job.failedAt) : 'time unknown'}
                          </span>
                          <span className="text-muted">{job.failedReason || 'No failure reason logged.'}</span>
                        </div>
                        <button type="button" className="button-secondary" disabled>
                          Retry soon
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </LayoutShell>
  );
}
