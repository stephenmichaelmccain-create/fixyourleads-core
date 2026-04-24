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
    case 'review_score_received':
      return 'Score received';
    case 'review_positive_follow_up_sent':
      return 'Google review sent';
    case 'review_negative_follow_up_sent':
      return 'Private follow-up sent';
    case 'review_owner_alert_processed':
      return 'Owner notified';
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
  const score = typeof record.score === 'number' ? record.score : null;
  const deliveryStatus = typeof record.deliveryStatus === 'string' ? record.deliveryStatus : '';
  const targetPhone = typeof record.targetPhone === 'string' ? record.targetPhone : '';

  if (score !== null) {
    return `Score ${score}/10`;
  }

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
  const thirtyDaysAgo = startOfDaysAgo(29);

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

  const [
    leadsThisWeek,
    repliesThisMonth,
    bookingsThisWeek,
    reviewScoresThisMonth,
    lastInbound,
    lastOutbound,
    lastBooking,
    recentFailure,
    recentEvents,
    recentConversations,
    sourceBreakdown
  ] = await Promise.all([
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
        db.message.count({
          where: {
            companyId: id,
            direction: 'INBOUND',
            createdAt: { gte: thirtyDaysAgo }
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
        db.eventLog.count({
          where: {
            companyId: id,
            eventType: 'review_score_received',
            createdAt: { gte: thirtyDaysAgo }
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
                'review_request_sent',
                'review_score_received',
                'review_positive_follow_up_sent',
                'review_negative_follow_up_sent',
                'review_owner_alert_processed'
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
    ),
    safeLoad(
      () =>
        db.conversation.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                content: true,
                direction: true,
                createdAt: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.lead.groupBy({
          by: ['source'],
          where: {
            companyId: id,
            createdAt: { gte: thirtyDaysAgo }
          },
          _count: {
            source: true
          },
          orderBy: {
            _count: {
              source: 'desc'
            }
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
              <span className="metric-label">Replies this month</span>
              <strong className="workspace-stats-value">{repliesThisMonth}</strong>
              <span className="tiny-muted">Inbound responses captured in the last 30 days.</span>
            </div>
            <div className="client-record-stat">
              <span className="metric-label">Bookings this week</span>
              <strong className="workspace-stats-value">{bookingsThisWeek}</strong>
              <span className="tiny-muted">Appointments created in the last 7 days.</span>
            </div>
            <div className="client-record-stat">
              <span className="metric-label">Last reply received</span>
              <strong className="workspace-stats-value">{formatCompactDateTime(lastInbound?.createdAt)}</strong>
              <span className="tiny-muted">Most recent inbound reply captured.</span>
            </div>
            <div className="client-record-stat">
              <span className="metric-label">Review replies this month</span>
              <strong className="workspace-stats-value">{reviewScoresThisMonth}</strong>
              <span className="tiny-muted">Customer ratings captured in the last 30 days.</span>
            </div>
          </div>

          <div className="client-status-grid">
            <section className="panel panel-stack">
              <div className="metric-label">Lead flow</div>
              <h2 className="section-title">How leads are showing up</h2>
              <div className="workspace-list">
                {sourceBreakdown.length === 0 ? (
                  <div className="workspace-list-item">
                    <span className="tiny-muted">No tracked lead sources yet in the last 30 days.</span>
                  </div>
                ) : (
                  sourceBreakdown.map((sourceRow, index) => (
                    <div key={`${sourceRow.source || 'unknown'}-${index}`} className="workspace-list-item">
                      <div className="workspace-list-header">
                        <strong>{sourceRow.source || 'Unknown source'}</strong>
                        <span className="tiny-muted">{sourceRow._count.source} leads</span>
                      </div>
                      <span className="tiny-muted">Tracked inside Fix Your Leads from this source in the last 30 days.</span>
                    </div>
                  ))
                )}
              </div>
            </section>

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
              <div className="metric-label">Recent conversations</div>
              <h2 className="section-title">Latest threads</h2>
              <div className="workspace-list">
                {recentConversations.length === 0 ? (
                  <div className="workspace-list-item">
                    <span className="tiny-muted">No conversation threads have been recorded yet.</span>
                  </div>
                ) : (
                  recentConversations.map((conversation) => (
                    <div key={conversation.id} className="workspace-list-item">
                      <div className="workspace-list-header">
                        <strong>{conversation.contact.name || conversation.contact.phone || 'Unnamed contact'}</strong>
                        <span className="tiny-muted">{formatCompactDateTime(conversation.messages[0]?.createdAt || conversation.createdAt)}</span>
                      </div>
                      <span className="tiny-muted">
                        {conversation.messages[0]
                          ? `${conversation.messages[0].direction === 'INBOUND' ? 'Reply' : 'Outbound'}: ${conversation.messages[0].content}`
                          : 'Conversation created with no messages yet.'}
                      </span>
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
