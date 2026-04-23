import { notFound } from 'next/navigation';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

function formatCompactDateTime(value: Date | string | null | undefined) {
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

function formatStatusLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function trimPreview(value: string, maxLength = 120) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

export default async function ClientDiagnosticsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const next14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          notificationEmail: true,
          telnyxInboundNumber: true,
          createdAt: true,
          telnyxInboundNumbers: {
            select: { number: true },
            orderBy: { createdAt: 'asc' }
          }
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const inboundNumbers = allInboundNumbers(company);
  const setupGaps = [
    !hasInboundRouting(company) ? 'Inbound routing number' : null,
    !company.notificationEmail ? 'Client notification email' : null
  ].filter(Boolean) as string[];

  const [leadStatusRows, recentEvents, recentMessages, counts] = await Promise.all([
    safeLoad(
      () =>
        db.lead.groupBy({
          by: ['status'],
          where: {
            companyId: id,
            createdAt: { gte: last30Days }
          },
          _count: { _all: true }
        }),
      []
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            eventType: true,
            createdAt: true
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.message.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: {
            id: true,
            conversationId: true,
            direction: true,
            content: true,
            createdAt: true
          }
        }),
      []
    ),
    safeLoad(
      () =>
        Promise.all([
          db.lead.count({
            where: {
              companyId: id,
              createdAt: { gte: last30Days }
            }
          }),
          db.conversation.count({
            where: {
              companyId: id,
              createdAt: { gte: last30Days }
            }
          }),
          db.message.count({
            where: {
              companyId: id,
              createdAt: { gte: last24Hours }
            }
          }),
          db.appointment.count({
            where: {
              companyId: id,
              startTime: {
                gte: now,
                lte: next14Days
              }
            }
          }),
          db.eventLog.count({
            where: {
              companyId: id,
              createdAt: { gte: last24Hours }
            }
          })
        ]),
      [0, 0, 0, 0, 0]
    )
  ]);

  const leadStatusBreakdown = leadStatusRows
    .map((row) => ({
      status: row.status,
      count: row._count._all
    }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));

  return (
    <LayoutShell
      title={`${company.name} health`}
      description="Client-specific setup, activity, and routing visibility without digging through the full diagnostics stack."
      companyId={company.id}
      companyName={company.name}
      section="diagnostics"
      variant="workspace"
    >
      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Client health</div>
            <h2 className="section-title section-title-large">{company.name}</h2>
            <div className="inline-row">
              <span className={`status-chip ${setupGaps.length > 0 ? 'status-chip-attention' : ''}`}>
                <span className={`status-dot ${setupGaps.length > 0 ? 'warn' : 'ok'}`} />
                {setupGaps.length > 0 ? `${setupGaps.length} setup gap${setupGaps.length === 1 ? '' : 's'}` : 'Healthy'}
              </span>
            </div>
          </div>
          <div className="inline-actions">
            <a className="button-secondary" href={`/clients/${company.id}`}>
              Open workspace
            </a>
            <a className="button-secondary" href={`/?companyId=${company.id}`}>
              Open activity log
            </a>
            <a className="button" href={`/clients/${company.id}#setup`}>
              Edit profile
            </a>
          </div>
        </div>
      </section>

      <div className="metric-grid">
        <section className="metric-card panel-stack">
          <div className="metric-label">Inbound routing</div>
          <div className="metric-value">{inboundNumbers.length}</div>
          <div className="metric-copy">{hasInboundRouting(company) ? 'Inbound numbers connected' : 'Missing Telnyx routing'}</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Client email</div>
          <div className="metric-value">{company.notificationEmail ? 'Set' : 'Missing'}</div>
          <div className="metric-copy">{company.notificationEmail || 'Add a clinic notification email in setup.'}</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Leads (30d)</div>
          <div className="metric-value">{counts[0]}</div>
          <div className="metric-copy">Recent lead volume for this client workspace.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Threads (30d)</div>
          <div className="metric-value">{counts[1]}</div>
          <div className="metric-copy">Message threads created in the last 30 days.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Messages (24h)</div>
          <div className="metric-value">{counts[2]}</div>
          <div className="metric-copy">Text activity in the last 24 hours.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Appointments (14d)</div>
          <div className="metric-value">{counts[3]}</div>
          <div className="metric-copy">Upcoming appointments on the board now.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Activity Log (24h)</div>
          <div className="metric-value">{counts[4]}</div>
          <div className="metric-copy">Activity log entries recorded in the last 24 hours.</div>
        </section>
      </div>

      <section className="panel panel-stack">
        <div className="metric-label">Setup readiness</div>
        {setupGaps.length === 0 ? (
          <div className="empty-state">This client has inbound routing and a notification email configured.</div>
        ) : (
          <div className="readiness-pills">
            {setupGaps.map((gap) => (
              <span key={gap} className="readiness-pill is-warn">
                {gap}
              </span>
            ))}
          </div>
        )}
        <div className="key-value-grid">
          <div className="key-value-card">
            <span className="key-value-label">Notification email</span>
            {company.notificationEmail || 'Not set'}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Inbound numbers</span>
            {inboundNumbers.length === 0 ? 'Not set' : inboundNumbers.join(', ')}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Primary sender</span>
            {inboundNumbers[0] || 'No primary routing number yet'}
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Routing scope</span>
            {inboundNumbers.length <= 1 ? 'Single clinic number' : `${inboundNumbers.length} clinic numbers assigned`}
          </div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Lead status mix (30d)</div>
        <div className="key-value-grid">
          {leadStatusBreakdown.length === 0 ? (
            <div className="key-value-card">
              <span className="key-value-label">Lead status</span>
              No recent leads
            </div>
          ) : (
            leadStatusBreakdown.map((entry) => (
              <div key={entry.status} className="key-value-card">
                <span className="key-value-label">{formatStatusLabel(entry.status)}</span>
                {entry.count}
              </div>
            ))
          )}
        </div>
      </section>

      <div className="record-grid">
        <section className="panel panel-stack">
          <div className="metric-label">Recent events</div>
          {recentEvents.length === 0 ? (
            <div className="empty-state">No event log entries for this client yet.</div>
          ) : (
            <div className="status-list">
              {recentEvents.map((event) => (
                <div key={event.id} className="status-item" style={{ alignItems: 'flex-start' }}>
                  <div className="panel-stack" style={{ gap: 6 }}>
                    <span className="status-label">
                      <span className="status-dot ok" />
                      {event.eventType}
                    </span>
                    <span className="tiny-muted">{formatCompactDateTime(event.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Recent messages</div>
          {recentMessages.length === 0 ? (
            <div className="empty-state">No text activity for this client yet.</div>
          ) : (
            <div className="status-list">
              {recentMessages.map((message) => (
                <div key={message.id} className="status-item" style={{ alignItems: 'flex-start' }}>
                  <div className="panel-stack" style={{ gap: 6 }}>
                    <span className="status-label">
                      <span className={`status-dot ${message.direction === 'OUTBOUND' ? 'warn' : 'ok'}`} />
                      {message.direction}
                    </span>
                    <span className="tiny-muted">{formatCompactDateTime(message.createdAt)}</span>
                    <a className="text-muted" href={`/conversations/${message.conversationId}`}>
                      {trimPreview(message.content)}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </LayoutShell>
  );
}
