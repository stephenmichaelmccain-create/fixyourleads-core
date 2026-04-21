import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type EventCategory = 'all' | 'messaging' | 'booking' | 'lead' | 'suppression' | 'system';

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getEventCategory(eventType: string): Exclude<EventCategory, 'all'> {
  if (
    eventType.startsWith('telnyx_message_') ||
    eventType === 'message_received' ||
    eventType === 'manual_message_sent' ||
    eventType === 'contact_requested_help'
  ) {
    return 'messaging';
  }

  if (eventType.startsWith('appointment_') || eventType === 'booking_intent_detected') {
    return 'booking';
  }

  if (eventType.startsWith('lead_') || eventType.startsWith('google_maps_')) {
    if (eventType === 'lead_suppressed' || eventType === 'lead_unsuppressed') {
      return 'suppression';
    }

    return 'lead';
  }

  return 'system';
}

function getEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    lead_created: 'Lead created',
    lead_reingested: 'Lead deduped',
    google_maps_import_completed: 'Google Maps import finished',
    message_received: 'Reply received',
    manual_message_sent: 'Outbound text sent',
    telnyx_message_sent: 'Telnyx accepted message',
    telnyx_message_finalized: 'Telnyx finalized message',
    telnyx_message_delivery_failed: 'Message delivery failed',
    telnyx_message_delivery_unconfirmed: 'Message delivery unconfirmed',
    appointment_booked: 'Appointment booked',
    appointment_booking_duplicate: 'Duplicate booking prevented',
    lead_suppressed: 'Lead suppressed',
    lead_unsuppressed: 'Lead unsuppressed',
    contact_requested_help: 'Contact asked for help',
    booking_intent_detected: 'Booking intent detected',
    lead_queue_skipped: 'Lead queue skipped'
  };

  return labels[eventType] || eventType.replaceAll('_', ' ');
}

function getEventSummary(eventType: string, payload: Record<string, unknown>) {
  switch (eventType) {
    case 'lead_created':
      return `New lead added${readString(payload.source) ? ` from ${readString(payload.source)}` : ''}.`;
    case 'lead_reingested':
      return `Existing lead matched by ${readString(payload.matchedBy) || 'known contact data'} instead of creating a duplicate.`;
    case 'google_maps_import_completed':
      return `${payload.importedCount ?? 0} imported, ${payload.duplicateCount ?? 0} duplicates, ${payload.skippedCount ?? 0} skipped.`;
    case 'message_received':
      return `Inbound reply stored on the live conversation thread.`;
    case 'manual_message_sent':
      return `Operator sent an outbound text from the workspace.`;
    case 'telnyx_message_sent':
      return `Telnyx accepted the outbound text for delivery.`;
    case 'telnyx_message_finalized':
      return `Delivery finalized${readString(payload.deliveryStatus) ? ` with status ${readString(payload.deliveryStatus)}` : ''}.`;
    case 'telnyx_message_delivery_failed':
      return `Telnyx marked the outbound text as failed${readString(payload.deliveryStatus) ? ` (${readString(payload.deliveryStatus)})` : ''}.`;
    case 'telnyx_message_delivery_unconfirmed':
      return `Telnyx could not confirm delivery yet.`;
    case 'appointment_booked':
      return `Booking created${readString(payload.startTime) ? ` for ${new Date(readString(payload.startTime) || '').toLocaleString()}` : ''}.`;
    case 'appointment_booking_duplicate':
      return `A duplicate booking attempt was blocked before creating another appointment.`;
    case 'lead_suppressed':
      return `This lead is marked do-not-contact${readString(payload.reason) ? ` (${readString(payload.reason)})` : ''}.`;
    case 'lead_unsuppressed':
      return `This lead was reopened for outreach.`;
    case 'contact_requested_help':
      return `The contact asked for human help in the thread.`;
    case 'booking_intent_detected':
      return `The incoming message looked like booking intent.`;
    case 'lead_queue_skipped':
      return `Initial lead queueing was skipped by the worker.`;
    default:
      return `Raw event captured for audit visibility.`;
  }
}

export default async function EventsPage({
  searchParams
}: {
  searchParams?: Promise<{ companyId?: string; eventCategory?: EventCategory }>;
}) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';
  const selectedCategory = params.eventCategory || 'all';
  const selectedCompany = companyId
    ? await safeLoad(
        () =>
          db.company.findUnique({
            where: { id: companyId },
            select: { id: true, name: true }
          }),
        null
      )
    : null;

  const events = companyId
    ? await safeLoad(
        () =>
          db.eventLog.findMany({
            where: { companyId },
            orderBy: { createdAt: 'desc' },
            take: 200
          }),
        []
      )
    : [];
  const filteredEvents =
    selectedCategory === 'all'
      ? events
      : events.filter((event) => getEventCategory(event.eventType) === selectedCategory);
  const categoryCounts = events.reduce(
    (counts, event) => {
      counts[getEventCategory(event.eventType)] += 1;
      return counts;
    },
    {
      messaging: 0,
      booking: 0,
      lead: 0,
      suppression: 0,
      system: 0
    } satisfies Record<Exclude<EventCategory, 'all'>, number>
  );
  const categories: Array<{ key: EventCategory; label: string; count: number }> = [
    { key: 'all', label: 'All events', count: events.length },
    { key: 'messaging', label: 'Messaging', count: categoryCounts.messaging },
    { key: 'booking', label: 'Bookings', count: categoryCounts.booking },
    { key: 'lead', label: 'Leads', count: categoryCounts.lead },
    { key: 'suppression', label: 'Suppression', count: categoryCounts.suppression },
    { key: 'system', label: 'System', count: categoryCounts.system }
  ];
  const categoryHref = (category: EventCategory) =>
    category === 'all'
      ? `/events?companyId=${encodeURIComponent(companyId)}`
      : `/events?companyId=${encodeURIComponent(companyId)}&eventCategory=${encodeURIComponent(category)}`;

  return (
    <LayoutShell
      title="Events"
      description="Every lead touch, message, suppression, and booking should leave a trail. This page is the operating audit log."
      companyId={companyId}
      companyName={selectedCompany?.name || undefined}
      section="events"
    >
      <CompanySelectorBar action="/events" initialCompanyId={companyId} />

      {!companyId && <div className="empty-state">Choose a company by name to load the audit trail.</div>}

      {companyId && events.length > 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">Event filters</div>
          <div className="record-links">
            {categories.map((category) => (
              <a
                key={category.key}
                className={selectedCategory === category.key ? 'button' : 'button-secondary'}
                href={categoryHref(category.key)}
              >
                {category.label} ({category.count})
              </a>
            ))}
          </div>
          <div className="text-muted">
            Start with messaging and bookings when you need to answer what actually happened in a live workspace.
          </div>
        </section>
      )}

      {companyId && events.length === 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">No audit trail yet</div>
          <h2 className="section-title">
            {selectedCompany ? `${selectedCompany.name} has not produced any logged events yet.` : 'No events found yet.'}
          </h2>
          <p className="text-muted">
            Events start appearing once leads are created, texts move, suppressions fire, or bookings are made.
          </p>
          <div className="action-cluster">
            <a className="button" href={`/leads?companyId=${companyId}`}>
              Open leads
            </a>
            <a className="button-secondary" href={`/conversations?companyId=${companyId}`}>
              Open conversations
            </a>
            <a className="button-ghost" href={`/companies#company-${companyId}`}>
              Review setup
            </a>
          </div>
        </section>
      )}

      {companyId && events.length > 0 && filteredEvents.length === 0 && (
        <div className="empty-state">No {selectedCategory} events yet for this workspace.</div>
      )}

      <div className="record-grid">
        {filteredEvents.map((event) => {
          const payload = typeof event.payload === 'object' && event.payload && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
          const category = getEventCategory(event.eventType);

          return (
          <section key={event.id} className="record-card">
            <div className="record-header">
              <div>
                <div className="metric-label">Event</div>
                <strong>{getEventLabel(event.eventType)}</strong>
                <div className="record-subtitle">{getEventSummary(event.eventType, payload)}</div>
              </div>
              <div className="panel-stack">
                <span className={`status-chip ${category === 'messaging' || category === 'booking' ? '' : 'status-chip-muted'}`}>
                  <strong>{category}</strong>
                </span>
                <div className="tiny-muted">{new Date(event.createdAt).toLocaleString()}</div>
              </div>
            </div>
            <details className="panel stack">
              <summary className="tiny-muted">Raw payload</summary>
              <pre className="code-block">{JSON.stringify(event.payload, null, 2)}</pre>
            </details>
          </section>
          );
        })}
      </div>
    </LayoutShell>
  );
}
