import { notFound } from 'next/navigation';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanyWorkspaceTabs } from '@/app/components/CompanyWorkspaceTabs';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';

export const dynamic = 'force-dynamic';

function formatCompactDateTime(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function shortMessage(value: string, max = 84) {
  const clean = value.trim().replace(/\s+/g, ' ');

  if (clean.length <= max) {
    return clean;
  }

  return `${clean.slice(0, max - 1)}…`;
}

function priorityRank(status: string) {
  if (status === 'NEW') {
    return 0;
  }

  if (status === 'CONTACTED') {
    return 1;
  }

  if (status === 'REPLIED') {
    return 2;
  }

  if (status === 'BOOKED') {
    return 3;
  }

  return 4;
}

function eventLabel(eventType: string) {
  return eventType.replaceAll('_', ' ');
}

function readEventSnippet(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidateKeys = ['content', 'text', 'body', 'message', 'summary', 'reason'];

  for (const key of candidateKeys) {
    const value = record[key];

    if (typeof value === 'string' && value.trim()) {
      return shortMessage(value);
    }
  }

  return null;
}

export default async function CompanyWorkspacePage({
  params
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id: companyId },
        include: {
          telnyxInboundNumbers: {
            select: { number: true },
            orderBy: { createdAt: 'asc' }
          },
          _count: {
            select: {
              leads: true,
              conversations: true,
              appointments: true
            }
          }
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [leadStatusRows, liveLeads, recentMessages, recentEvents, appointments] = await Promise.all([
    safeLoad(
      () =>
        db.lead.groupBy({
          by: ['status'],
          where: {
            companyId,
            status: { in: ['NEW', 'CONTACTED', 'REPLIED', 'BOOKED', 'SUPPRESSED'] }
          },
          _count: { _all: true }
        }),
      []
    ),
    safeLoad(
      () =>
        db.lead.findMany({
          where: { companyId },
          include: {
            contact: {
              select: {
                name: true,
                phone: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 12
        }),
      []
    ),
    safeLoad(
      () =>
        db.message.findMany({
          where: { companyId },
          include: {
            conversation: {
              select: {
                id: true,
                contact: {
                  select: {
                    name: true,
                    phone: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 6
        }),
      []
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          take: 8
        }),
      []
    ),
    safeLoad(
      () =>
        db.appointment.findMany({
          where: { companyId },
          select: {
            id: true,
            startTime: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true,
                conversations: {
                  where: { companyId },
                  select: { id: true },
                  take: 1
                }
              }
            }
          },
          orderBy: [{ startTime: 'asc' }, { createdAt: 'desc' }],
          take: 6
        }),
      []
    )
  ]);

  const leadCounts = leadStatusRows.reduce(
    (acc, row) => {
      acc[row.status] = row._count._all;
      return acc;
    },
    {
      NEW: 0,
      CONTACTED: 0,
      REPLIED: 0,
      BOOKED: 0,
      SUPPRESSED: 0
    } as Record<'NEW' | 'CONTACTED' | 'REPLIED' | 'BOOKED' | 'SUPPRESSED', number>
  );

  const readyLeadCount = leadCounts.NEW + leadCounts.CONTACTED + leadCounts.REPLIED;
  const inboundNumbers = allInboundNumbers(company);
  const routingReady = hasInboundRouting(company);
  const setupGaps = [
    !routingReady ? 'Inbound routing number' : null,
    !company.notificationEmail ? 'Client notification email' : null
  ].filter(Boolean) as string[];

  const leadPreview = [...liveLeads]
    .sort((left, right) => {
      const leftRank = priorityRank(left.status);
      const rightRank = priorityRank(right.status);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    })
    .slice(0, 4);

  const telnyxLiveRows = recentEvents
    .filter((event) => event.eventType.startsWith('telnyx_') || event.eventType === 'message_received' || event.eventType === 'manual_message_sent')
    .slice(0, 4);

  const bookingPreview = appointments.slice(0, 4);

  return (
    <LayoutShell
      title={company.name}
      description="Run this client from one simple workspace: scan the live lanes here, then click into the exact queue that needs attention."
      companyId={company.id}
      companyName={company.name}
      section="companies"
    >
      <CompanyWorkspaceTabs companyId={company.id} companyName={company.name} />

      <div className="panel-grid">
        <section className="panel panel-dark panel-stack">
          <div className="metric-label">Company workspace</div>
          <h2 className="section-title section-title-large">Live lanes for {company.name}</h2>
          <p className="metric-copy">
            This page should feel like the operator’s command board: live lead movement, Telnyx activity, text transcript previews, and bookings.
          </p>
          <div className="action-cluster">
            <a className="button" href={`/leads?companyId=${company.id}`}>
              Open leads
            </a>
            <a className="button-secondary" href={`/conversations?companyId=${company.id}`}>
              Open transcripts
            </a>
            <a className="button-ghost" href={`/bookings?companyId=${company.id}`}>
              Open bookings
            </a>
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Setup status</div>
          <h2 className="section-title">
            {setupGaps.length === 0 ? 'This company is ready to work.' : 'Finish these setup items before trusting the live lanes.'}
          </h2>
          <div className="workspace-readiness">
            <span className={`readiness-pill${routingReady ? ' is-ready' : ''}`}>
              {routingReady ? 'Inbound routing ready' : 'Inbound routing missing'}
            </span>
            <span className={`readiness-pill${company.notificationEmail ? ' is-ready' : ''}`}>
              {company.notificationEmail ? 'Client email ready' : 'Client email missing'}
            </span>
          </div>
          <div className="key-value-grid">
            <div className="key-value-card">
              <span className="key-value-label">Notification email</span>
              {company.notificationEmail || 'Not set'}
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Inbound numbers</span>
              {inboundNumbers.length > 0 ? inboundNumbers.join(', ') : 'No inbound numbers yet'}
            </div>
          </div>
          <div className="action-cluster">
            <a className="button-secondary" href={`/companies#company-${company.id}`}>
              Edit company settings
            </a>
          </div>
        </section>
      </div>

      <section className="panel panel-stack">
        <div className="metric-label">Live workspace board</div>
        <h2 className="section-title">Scan each lane here, then click into the full view only when you need it.</h2>
        <div className="workspace-live-grid">
          <a className="workspace-live-card" href={`/leads?companyId=${company.id}`}>
            <div className="workspace-live-card-header">
              <div>
                <div className="metric-label">Leads and status</div>
                <strong className="section-title">Lead queue</strong>
              </div>
              <span className="status-chip">
                <strong>Ready</strong> {readyLeadCount}
              </span>
            </div>
            <div className="workspace-live-list">
              {leadPreview.length === 0 ? (
                <div className="workspace-live-empty">No leads in this company yet.</div>
              ) : (
                leadPreview.map((lead) => (
                  <div key={lead.id} className="workspace-live-row">
                    <div>
                      <strong className="workspace-live-row-title">{lead.contact?.name || 'Unnamed contact'}</strong>
                      <div className="workspace-live-row-meta">{lead.contact?.phone || 'No phone on file'}</div>
                    </div>
                    <span className={`status-chip ${lead.status === 'REPLIED' ? 'status-chip-attention' : lead.status === 'SUPPRESSED' ? 'status-chip-muted' : ''}`}>
                      <strong>Status</strong> {lead.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </a>

          <a className="workspace-live-card" href={`/events?companyId=${company.id}`}>
            <div className="workspace-live-card-header">
              <div>
                <div className="metric-label">Call lane</div>
                <strong className="section-title">Telnyx live</strong>
              </div>
              <span className="status-chip">
                <strong>Events</strong> {telnyxLiveRows.length}
              </span>
            </div>
            <div className="workspace-live-list">
              {telnyxLiveRows.length === 0 ? (
                <div className="workspace-live-empty">No Telnyx events yet for this company.</div>
              ) : (
                telnyxLiveRows.map((event) => (
                  <div key={event.id} className="workspace-live-row">
                    <div>
                      <strong className="workspace-live-row-title">{eventLabel(event.eventType)}</strong>
                      <div className="workspace-live-row-meta">
                        {readEventSnippet(event.payload) || 'Live Telnyx activity captured for audit.'}
                      </div>
                    </div>
                    <span className="tiny-muted">{formatCompactDateTime(event.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </a>

          <a className="workspace-live-card" href={`/conversations?companyId=${company.id}`}>
            <div className="workspace-live-card-header">
              <div>
                <div className="metric-label">Text sequences</div>
                <strong className="section-title">Transcript preview</strong>
              </div>
              <span className="status-chip">
                <strong>Threads</strong> {company._count.conversations}
              </span>
            </div>
            <div className="workspace-live-list">
              {recentMessages.length === 0 ? (
                <div className="workspace-live-empty">No text transcript yet for this company.</div>
              ) : (
                recentMessages.map((message) => (
                  <div key={message.id} className="workspace-live-row">
                    <div>
                      <strong className="workspace-live-row-title">
                        {message.conversation.contact?.name || 'Unnamed contact'}
                      </strong>
                      <div className="workspace-live-row-meta">
                        <strong>{message.direction}</strong> {shortMessage(message.content)}
                      </div>
                    </div>
                    <span className="tiny-muted">{formatCompactDateTime(message.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </a>

          <a className="workspace-live-card" href={`/bookings?companyId=${company.id}`}>
            <div className="workspace-live-card-header">
              <div>
                <div className="metric-label">Bookings</div>
                <strong className="section-title">Upcoming appointments</strong>
              </div>
              <span className="status-chip">
                <strong>Total</strong> {company._count.appointments}
              </span>
            </div>
            <div className="workspace-live-list">
              {bookingPreview.length === 0 ? (
                <div className="workspace-live-empty">No bookings attached to this company yet.</div>
              ) : (
                bookingPreview.map((appointment) => (
                  <div key={appointment.id} className="workspace-live-row">
                    <div>
                      <strong className="workspace-live-row-title">{appointment.contact?.name || 'Unnamed contact'}</strong>
                      <div className="workspace-live-row-meta">
                        {appointment.contact?.phone || 'No phone'} · {formatCompactDateTime(appointment.startTime)}
                      </div>
                    </div>
                    <span className="tiny-muted">
                      {appointment.contact?.conversations?.[0]?.id ? 'Thread ready' : 'Queue view'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </a>
        </div>
      </section>
    </LayoutShell>
  );
}
