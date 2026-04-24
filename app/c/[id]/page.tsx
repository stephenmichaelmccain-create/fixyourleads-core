import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
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

function startOfDaysAgo(daysAgo: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function activityLabel(eventType: string) {
  switch (eventType) {
    case 'message_received':
      return 'Reply received';
    case 'operator_messaging_test_sent':
      return 'SMS test sent';
    case 'telnyx_message_sent':
      return 'SMS accepted';
    case 'telnyx_message_delivery_failed':
      return 'Delivery issue';
    case 'appointment_booked':
      return 'Appointment booked';
    case 'booking_confirmation_sent':
      return 'Booking confirmed';
    case 'review_request_sent':
      return 'Review request sent';
    default:
      return eventType.replace(/_/g, ' ');
  }
}

function activityDetail(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Recent activity recorded.';
  }

  const record = payload as Record<string, unknown>;
  const detail = typeof record.detail === 'string' ? record.detail : '';
  const deliveryStatus = typeof record.deliveryStatus === 'string' ? record.deliveryStatus : '';
  const targetPhone = typeof record.targetPhone === 'string' ? record.targetPhone : '';

  return detail || deliveryStatus || targetPhone || 'Recent activity recorded.';
}

function computeClientStatus(input: {
  recentFailureEventType: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastBookingAt: Date | null;
}) {
  const { recentFailureEventType, lastInboundAt, lastOutboundAt, lastBookingAt } = input;

  if (recentFailureEventType) {
    return {
      label: 'Needs attention',
      tone: 'warn' as const,
      detail: 'A recent delivery or test issue needs an operator review.'
    };
  }

  if (lastInboundAt || lastOutboundAt || lastBookingAt) {
    return {
      label: 'Live',
      tone: 'ready' as const,
      detail: 'Messaging and booking activity have been recorded for this client.'
    };
  }

  return {
    label: 'Setup in progress',
    tone: 'pending' as const,
    detail: 'The workspace is configured, but we have not yet seen enough live activity.'
  };
}

export default async function ClientStatusPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sevenDaysAgo = startOfDaysAgo(6);

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          website: true,
          createdAt: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [leadsThisWeek, bookingsThisWeek, lastInbound, lastOutbound, lastBooking, recentFailure, recentEvents] = await Promise.all([
    safeLoad(
      () =>
        db.lead.count({
          where: {
            companyId: id,
            createdAt: { gte: sevenDaysAgo }
          }
        }),
      0
    ),
    safeLoad(
      () =>
        db.appointment.count({
          where: {
            companyId: id,
            createdAt: { gte: sevenDaysAgo }
          }
        }),
      0
    ),
    safeLoad(
      () =>
        db.message.findFirst({
          where: {
            companyId: id,
            direction: 'INBOUND'
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.message.findFirst({
          where: {
            companyId: id,
            direction: 'OUTBOUND'
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.appointment.findFirst({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.eventLog.findFirst({
          where: {
            companyId: id,
            eventType: {
              in: ['telnyx_message_delivery_failed', 'operator_messaging_test_failed', 'booking_confirmation_failed']
            }
          },
          orderBy: { createdAt: 'desc' },
          select: { eventType: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            companyId: id,
            eventType: {
              in: [
                'message_received',
                'operator_messaging_test_sent',
                'telnyx_message_sent',
                'telnyx_message_delivery_failed',
                'appointment_booked',
                'booking_confirmation_sent',
                'review_request_sent'
              ]
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            eventType: true,
            createdAt: true,
            payload: true
          }
        }),
      []
    )
  ]);

  const status = computeClientStatus({
    recentFailureEventType: recentFailure?.eventType || null,
    lastInboundAt: lastInbound?.createdAt || null,
    lastOutboundAt: lastOutbound?.createdAt || null,
    lastBookingAt: lastBooking?.createdAt || null
  });

  return (
    <main className="app-shell">
      <div className="workspace-shell">
        <section className="panel panel-stack client-status-page">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Fix Your Leads</div>
              <h1 className="section-title">{company.name}</h1>
              <div className="record-subtitle">
                A simple live view of what is happening in your Fix Your Leads workspace.
              </div>
            </div>
            <div className={`client-status-hero is-${status.tone}`}>
              <span className={`status-dot ${status.tone === 'ready' ? 'ok' : status.tone === 'warn' ? 'warn' : 'error'}`} />
              <strong>{status.label}</strong>
              <span className="tiny-muted">{status.detail}</span>
            </div>
          </div>

          <div className="client-record-stats">
            <div className="client-record-stat">
              <span className="metric-label">Leads this week</span>
              <strong className="workspace-stats-value">{leadsThisWeek}</strong>
              <span className="tiny-muted">New lead records created in the last 7 days.</span>
            </div>
            <div className="client-record-stat">
              <span className="metric-label">Bookings this week</span>
              <strong className="workspace-stats-value">{bookingsThisWeek}</strong>
              <span className="tiny-muted">Appointments created in the last 7 days.</span>
            </div>
            <div className="client-record-stat">
              <span className="metric-label">Last SMS sent</span>
              <strong className="workspace-stats-value">{formatCompactDateTime(lastOutbound?.createdAt)}</strong>
              <span className="tiny-muted">Most recent outbound message logged.</span>
            </div>
            <div className="client-record-stat">
              <span className="metric-label">Last reply received</span>
              <strong className="workspace-stats-value">{formatCompactDateTime(lastInbound?.createdAt)}</strong>
              <span className="tiny-muted">Most recent inbound reply captured.</span>
            </div>
          </div>

          <div className="client-status-grid">
            <section className="panel panel-stack">
              <div className="metric-label">Recent activity</div>
              <h2 className="section-title">What happened lately</h2>
              <div className="workspace-list">
                {recentEvents.length === 0 ? (
                  <div className="workspace-list-item">
                    <span className="tiny-muted">No public-facing activity yet for this client.</span>
                  </div>
                ) : (
                  recentEvents.map((event, index) => (
                    <div key={`${event.createdAt.toISOString()}-${index}`} className="workspace-list-item">
                      <div className="workspace-list-header">
                        <strong>{activityLabel(event.eventType)}</strong>
                        <span className="tiny-muted">{formatCompactDateTime(event.createdAt)}</span>
                      </div>
                      <span className="tiny-muted">{activityDetail(event.payload)}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel panel-stack">
              <div className="metric-label">Quick facts</div>
              <h2 className="section-title">Workspace snapshot</h2>
              <div className="client-record-sidebar-grid">
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">Workspace created</span>
                  <strong>{formatCompactDateTime(company.createdAt)}</strong>
                </div>
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">Website</span>
                  <strong>{company.website || 'Not added yet'}</strong>
                </div>
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">Current status</span>
                  <strong>{status.label}</strong>
                </div>
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">Support</span>
                  <strong>Fix Your Leads team</strong>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
