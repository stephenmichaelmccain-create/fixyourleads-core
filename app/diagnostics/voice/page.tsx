import { AppointmentExternalSyncStatus } from '@prisma/client';
import Link from 'next/link';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { getRuntimeHealth } from '@/lib/health';
import { loadAutomationSummary } from '@/services/automation';
import {
  assignUnroutedTelnyxNumberAction,
  markUnroutedTelnyxEventHandledAction
} from './actions';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
  detail?: string;
}>;

function formatDateTime(value: Date | string | null) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
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

function jsonPreview(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '{}';
  }
}

export default async function VoiceDiagnosticsPage({
  searchParams
}: {
  searchParams?: SearchParamShape;
}) {
  const query = (await searchParams) || {};
  const health = await getRuntimeHealth();

  const [failedAppointments, pendingAppointments, unroutedEvents, companies, automationSummary] = await Promise.all([
    db.appointment.findMany({
      where: {
        externalSyncStatus: AppointmentExternalSyncStatus.FAILED
      },
      orderBy: [{ startTime: 'asc' }],
      take: 12,
      select: {
        id: true,
        startTime: true,
        externalCalendarProvider: true,
        externalSyncError: true,
        externalSyncAttempts: true,
        company: {
          select: {
            id: true,
            name: true
          }
        },
        contact: {
          select: {
            name: true,
            phone: true
          }
        }
      }
    }),
    db.appointment.findMany({
      where: {
        externalSyncStatus: AppointmentExternalSyncStatus.PENDING
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 8,
      select: {
        id: true,
        startTime: true,
        externalSyncAttempts: true,
        company: {
          select: {
            id: true,
            name: true
          }
        },
        contact: {
          select: {
            name: true
          }
        }
      }
    }),
    db.unroutedTelnyxEvent.findMany({
      where: {
        handledAt: null
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 12,
      select: {
        id: true,
        eventType: true,
        reason: true,
        inboundNumber: true,
        fromNumber: true,
        eventId: true,
        messageId: true,
        payload: true,
        createdAt: true
      }
    }),
    db.company.findMany({
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true
      }
    }),
    loadAutomationSummary()
  ]);

  return (
    <LayoutShell
      title="Voice Diagnostics"
      description="Production voice failures that need operator attention: calendar sync issues, Google readiness, and unrouted Telnyx webhooks."
      section="diagnostics"
    >
      {query.notice ? (
        <section className="panel panel-stack" style={{ marginBottom: 20 }}>
          <div className="metric-label">Voice diagnostics update</div>
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            {query.notice === 'unrouted_handled'
              ? 'Unrouted event marked handled.'
              : query.notice === 'unrouted_assigned'
                ? 'Inbound number assigned.'
                : 'Could not update the unrouted event.'}
          </h2>
          <div className="text-muted">
            {query.notice === 'unrouted_handled'
              ? 'That event will drop out of the open unrouted queue on the next refresh.'
              : query.notice === 'unrouted_assigned'
                ? `Future Telnyx traffic for this number should now resolve to ${query.detail || 'the selected client'}.`
                : query.detail?.replace(/_/g, ' ') || 'Check the event details and try again.'}
          </div>
        </section>
      ) : null}

      <div className="metric-grid">
        <section className="metric-card panel-stack">
          <div className="metric-label">Calendar sync failed</div>
          <div className="metric-value">{health.volume.failedCalendarSyncs}</div>
          <div className="metric-copy">Appointments that saved internally but did not reach the external calendar.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Calendar sync pending</div>
          <div className="metric-value">{health.volume.pendingCalendarSyncs}</div>
          <div className="metric-copy">Appointments still waiting on the first successful sync.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Unrouted Telnyx events</div>
          <div className="metric-value">{health.volume.unroutedTelnyxEvents}</div>
          <div className="metric-copy">Webhook events that could not be matched to a client.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Calendar queue</div>
          <div className="metric-value">
            {health.queueHealth.find((queue) => queue.name === 'calendar_sync_queue')?.counts?.failed ?? 0} failed
          </div>
          <div className="metric-copy">Worker retries for background calendar sync jobs.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">n8n automation</div>
          <div className="metric-value">{automationSummary.ready}</div>
          <div className="metric-copy">
            {automationSummary.failed} failed · {automationSummary.actionRequired} need attention · {automationSummary.pending} provisioning
          </div>
        </section>
      </div>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Runtime readiness</div>
            <h2 className="section-title">Google calendar and alert paths</h2>
          </div>
        </div>
        <div className="status-list">
          {[
            ['Google Calendar', health.checks.googleCalendar.status, health.checks.googleCalendar.detail || 'No detail'],
            ['n8n automation', health.checks.n8nAutomation.status, health.checks.n8nAutomation.detail || 'No detail'],
            ['Operator alerts', health.checks.operatorAlerts.status, health.checks.operatorAlerts.detail || 'No detail'],
            ['SMTP notifications', health.checks.notifications.status, health.checks.notifications.detail || 'No detail'],
            ['Worker heartbeat', health.checks.workerHeartbeat.status, health.checks.workerHeartbeat.detail || 'No detail']
          ].map(([label, status, detail]) => (
            <div key={label} className="status-item">
              <span className="status-label">
                <span className={`status-dot ${statusClass(String(status))}`} />
                {label}
              </span>
              <span className="text-muted">{detail}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Automation exceptions</div>
            <h2 className="section-title">Clients whose n8n workflow is not fully ready</h2>
          </div>
        </div>

        {automationSummary.rows.filter((row) => row.status !== 'READY').length === 0 ? (
          <div className="empty-state">No automation blockers are open right now.</div>
        ) : (
          <div className="record-grid">
            {automationSummary.rows
              .filter((row) => row.status !== 'READY')
              .slice(0, 8)
              .map((row) => (
                <article key={row.companyId} className="record-card">
                  <div className="record-card-live-head">
                    <span
                      className={
                        row.status === 'FAILED'
                          ? 'status-chip status-chip-attention'
                          : row.status === 'ACTION_REQUIRED'
                            ? 'status-chip status-chip-attention'
                            : 'status-chip status-chip-muted'
                      }
                    >
                      <span className={`status-dot ${row.status === 'FAILED' ? 'error' : 'warn'}`} />
                      {row.status.replace(/_/g, ' ')}
                    </span>
                    <span className="tiny-muted">{row.updatedAt ? formatDateTime(row.updatedAt) : '—'}</span>
                  </div>
                  <div className="panel-stack">
                    <strong>{row.companyName}</strong>
                    <div className="text-muted">{row.lastError || 'Open the n8n workspace and retry provisioning.'}</div>
                  </div>
                  <div className="action-cluster">
                    <Link className="button-ghost" href={`/clients/${row.companyId}/connections`}>
                      Open connections
                    </Link>
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Failed calendar syncs</div>
            <h2 className="section-title">Appointments that need retry or setup repair</h2>
          </div>
          <Link className="button-secondary" href="/meetings">
            Open meetings board
          </Link>
        </div>

        {failedAppointments.length === 0 ? (
          <div className="empty-state">No failed calendar syncs right now.</div>
        ) : (
          <div className="record-grid">
            {failedAppointments.map((appointment) => (
              <article key={appointment.id} className="record-card">
                <div className="record-card-live-head">
                  <span className="status-chip status-chip-attention">
                    <span className="status-dot error" />
                    Failed
                  </span>
                  <span className="tiny-muted">{formatDateTime(appointment.startTime)}</span>
                </div>
                <div className="panel-stack">
                  <strong>{appointment.company.name}</strong>
                  <div className="text-muted">{appointment.contact.name?.trim() || appointment.contact.phone || 'Unknown contact'}</div>
                  <div className="text-muted">
                    {appointment.externalCalendarProvider || 'google_calendar'} · {appointment.externalSyncAttempts} attempts
                  </div>
                  <div className="text-muted">{appointment.externalSyncError || 'Unknown sync error'}</div>
                </div>
                <div className="action-cluster">
                  <Link className="button-ghost" href="/meetings">
                    Retry from meetings
                  </Link>
                  <Link className="button-ghost" href={`/clients/${appointment.company.id}`}>
                    Open client
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Pending syncs</div>
            <h2 className="section-title">Recently booked appointments still waiting on sync</h2>
          </div>
        </div>

        {pendingAppointments.length === 0 ? (
          <div className="empty-state">No pending appointment syncs right now.</div>
        ) : (
          <div className="status-list">
            {pendingAppointments.map((appointment) => (
              <div key={appointment.id} className="status-item" style={{ alignItems: 'flex-start' }}>
                <div className="panel-stack" style={{ gap: 6 }}>
                  <span className="status-label">
                    <span className="status-dot warn" />
                    {appointment.company.name}
                  </span>
                  <span className="tiny-muted">
                    {formatDateTime(appointment.startTime)} · {appointment.contact.name?.trim() || 'Unnamed contact'} · attempts {appointment.externalSyncAttempts}
                  </span>
                </div>
                <Link className="button-ghost" href="/meetings">
                  Open meetings
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Unrouted Telnyx events</div>
            <h2 className="section-title">Webhook events that never matched a client</h2>
          </div>
        </div>

        {unroutedEvents.length === 0 ? (
          <div className="empty-state">No unrouted Telnyx events are waiting for review.</div>
        ) : (
          <div className="record-grid">
            {unroutedEvents.map((event) => (
              <article key={event.id} className="record-card">
                <div className="record-card-live-head">
                  <span className="status-chip status-chip-attention">
                    <span className="status-dot error" />
                    {event.reason}
                  </span>
                  <span className="tiny-muted">{formatDateTime(event.createdAt)}</span>
                </div>
                <div className="panel-stack">
                  <strong>{event.eventType}</strong>
                  <div className="text-muted">to {event.inboundNumber || 'unknown'} · from {event.fromNumber || 'unknown'}</div>
                  <div className="text-muted">event {event.eventId || 'missing'} · message {event.messageId || 'missing'}</div>
                </div>
                <div className="action-cluster">
                  {event.inboundNumber ? (
                    <form action={assignUnroutedTelnyxNumberAction} className="panel panel-dark panel-stack">
                      <input type="hidden" name="eventId" value={event.id} />
                      <label className="metric-label" htmlFor={`assign-${event.id}`}>
                        Assign inbound number
                      </label>
                      <select
                        id={`assign-${event.id}`}
                        name="companyId"
                        defaultValue=""
                        style={{
                          minHeight: 42,
                          borderRadius: 14,
                          border: '1px solid rgba(136, 92, 255, 0.28)',
                          background: 'rgba(14, 10, 28, 0.96)',
                          color: 'rgba(245, 243, 255, 0.96)',
                          padding: '0 14px'
                        }}
                      >
                        <option value="" disabled>
                          Select client workspace
                        </option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="button-secondary">
                        Route {event.inboundNumber}
                      </button>
                    </form>
                  ) : null}
                  <form action={markUnroutedTelnyxEventHandledAction}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <button type="submit" className="button-ghost">
                      Mark handled
                    </button>
                  </form>
                </div>
                <details className="panel panel-dark panel-stack">
                  <summary className="metric-label">Payload preview</summary>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      color: 'rgba(231, 227, 255, 0.74)'
                    }}
                  >
                    {jsonPreview(event.payload)}
                  </pre>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>
    </LayoutShell>
  );
}
