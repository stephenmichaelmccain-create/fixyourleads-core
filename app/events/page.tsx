import { LayoutShell } from '@/app/components/LayoutShell';
import { LiveFeedControls } from '@/app/events/LiveFeedControls';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

const windowOptions = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'All time', value: 'all' }
] as const;

type SearchParamShape = Promise<{
  companyId?: string;
  eventType?: string;
  window?: string;
  q?: string;
}>;

function startForWindow(windowValue: string) {
  const now = Date.now();

  if (windowValue === '24h') {
    return new Date(now - 24 * 60 * 60 * 1000);
  }

  if (windowValue === '30d') {
    return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }

  if (windowValue === 'all') {
    return null;
  }

  return new Date(now - 7 * 24 * 60 * 60 * 1000);
}

function buildEventsHref({
  companyId,
  eventType,
  window,
  q
}: {
  companyId?: string;
  eventType?: string;
  window?: string;
  q?: string;
}) {
  const params = new URLSearchParams();

  if (companyId) {
    params.set('companyId', companyId);
  }

  if (eventType) {
    params.set('eventType', eventType);
  }

  if (window) {
    params.set('window', window);
  }

  if (q) {
    params.set('q', q);
  }

  const query = params.toString();
  return query ? `/events?${query}` : '/events';
}

function humanizeEventType(eventType: string) {
  return eventType
    .replace(/[._]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function eventTone(eventType: string) {
  const value = eventType.toLowerCase();

  if (value.includes('failed') || value.includes('error')) {
    return 'error';
  }

  if (
    value.includes('suppressed') ||
    value.includes('duplicate') ||
    value.includes('skipped') ||
    value.includes('missing')
  ) {
    return 'warn';
  }

  return 'ok';
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function shortPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const summaryParts = [
    record.contactId ? `contact ${String(record.contactId).slice(-6)}` : null,
    record.leadId ? `lead ${String(record.leadId).slice(-6)}` : null,
    record.conversationId ? `thread ${String(record.conversationId).slice(-6)}` : null,
    record.appointmentId ? `appointment ${String(record.appointmentId).slice(-6)}` : null,
    record.reason ? String(record.reason) : null,
    record.deliveryStatus ? `delivery ${String(record.deliveryStatus)}` : null,
    record.notificationStatus ? `email ${String(record.notificationStatus)}` : null,
    record.confirmationStatus ? `sms ${String(record.confirmationStatus)}` : null,
    record.query ? `query ${String(record.query)}` : null
  ].filter(Boolean) as string[];

  return summaryParts.length > 0 ? summaryParts.join(' · ') : null;
}

function payloadString(payload: unknown) {
  try {
    return JSON.stringify(payload);
  } catch {
    return '';
  }
}

function payloadLinks(companyId: string, payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const links = [
    record.leadId
      ? {
          href: `/leads/${String(record.leadId)}`,
          label: 'Open lead'
        }
      : null,
    record.conversationId
      ? {
          href: `/conversations/${String(record.conversationId)}`,
          label: 'Open thread'
        }
      : null,
    record.appointmentId
      ? {
          href: `/clients/${companyId}#bookings`,
          label: 'Open bookings'
        }
      : null
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  return links;
}

export default async function EventsPage({
  searchParams
}: {
  searchParams?: SearchParamShape;
}) {
  const params = (await searchParams) || {};
  const selectedCompanyId = String(params.companyId || '').trim();
  const selectedEventType = String(params.eventType || '').trim();
  const selectedWindow = String(params.window || '7d').trim() || '7d';
  const searchQuery = String(params.q || '').trim();
  const windowStart = startForWindow(selectedWindow);
  const snapshotAt = new Date().toISOString();

  const [companies, eventTypeRows, rawEvents] = await Promise.all([
    safeLoad(
      () =>
        db.company.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        }),
      []
    ),
    safeLoad(
      () =>
        db.eventLog.groupBy({
          by: ['eventType'],
          where: {
            ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
            ...(windowStart ? { createdAt: { gte: windowStart } } : {})
          },
          _count: { _all: true },
          orderBy: {
            _count: {
              eventType: 'desc'
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
            ...(selectedEventType ? { eventType: selectedEventType } : {}),
            ...(windowStart ? { createdAt: { gte: windowStart } } : {})
          },
          include: {
            company: {
              select: { id: true, name: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 250
        }),
      []
    )
  ]);

  const normalizedQuery = searchQuery.toLowerCase();
  const events = normalizedQuery
    ? rawEvents.filter((event) => {
        const haystack = [
          event.eventType,
          event.company?.name || '',
          payloadString(event.payload)
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      })
    : rawEvents;

  const latestEvent = events[0] || null;
  const visibleEventTypes = new Set(events.map((event) => event.eventType));
  const visibleCompanies = new Set(events.map((event) => event.companyId));
  const activeCompanyName = companies.find((company) => company.id === selectedCompanyId)?.name || null;

  return (
    <LayoutShell
      title="Master Event Log"
      description="A durable operator feed for what the system actually did: lead intake, outreach, inbound replies, booking activity, and worker outcomes."
      section="diagnostics"
    >
      <LiveFeedControls
        snapshotAt={snapshotAt}
        categoryLabel={selectedEventType ? humanizeEventType(selectedEventType) : selectedWindow === 'all' ? 'All events' : `Window ${selectedWindow}`}
        visibleCount={events.length}
        latestEventLabel={latestEvent ? humanizeEventType(latestEvent.eventType) : null}
        latestEventAt={latestEvent ? latestEvent.createdAt.toISOString() : null}
        companyName={activeCompanyName}
      />

      <div className="metric-grid">
        <section className="metric-card panel-stack">
          <div className="metric-label">Visible events</div>
          <div className="metric-value">{events.length}</div>
          <div className="metric-copy">Filtered operator events in the current view.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Event types</div>
          <div className="metric-value">{visibleEventTypes.size}</div>
          <div className="metric-copy">Distinct workflow events in this feed window.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Companies in view</div>
          <div className="metric-value">{visibleCompanies.size}</div>
          <div className="metric-copy">Client workspaces represented in this filtered log.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Latest event</div>
          <div className="metric-value">{latestEvent ? formatDateTime(latestEvent.createdAt) : '—'}</div>
          <div className="metric-copy">{latestEvent ? humanizeEventType(latestEvent.eventType) : 'No event in this view yet.'}</div>
        </section>
      </div>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Filters</div>
            <h2 className="section-title">Narrow the operator log without leaving the page.</h2>
          </div>
          <a className="button-ghost" href="/events">
            Reset
          </a>
        </div>

        <form action="/events" className="workspace-filter-form">
          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="events-company">
                Company
              </label>
              <select id="events-company" name="companyId" className="select-input" defaultValue={selectedCompanyId}>
                <option value="">All companies</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="events-type">
                Event type
              </label>
              <select id="events-type" name="eventType" className="select-input" defaultValue={selectedEventType}>
                <option value="">All event types</option>
                {eventTypeRows.map((row) => (
                  <option key={row.eventType} value={row.eventType}>
                    {humanizeEventType(row.eventType)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="events-window">
                Date range
              </label>
              <select id="events-window" name="window" className="select-input" defaultValue={selectedWindow}>
                {windowOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="events-query">
                Search payload
              </label>
              <input
                id="events-query"
                name="q"
                className="text-input"
                defaultValue={searchQuery}
                placeholder="booking, stop, query, delivery_failed"
              />
            </div>
          </div>

          <div className="workspace-filter-actions">
            <button type="submit" className="button-secondary">
              Apply filters
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Event feed</div>
            <h2 className="section-title">Durable workflow history for operators.</h2>
          </div>
          <div className="action-cluster">
            <a className="button-ghost" href="/diagnostics">
              Back to diagnostics
            </a>
            <a className="button-ghost" href="/diagnostics/workflows">
              Workflow map
            </a>
          </div>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">No events match the current filters.</div>
        ) : (
          <div className="record-grid">
            {events.map((event) => {
              const tone = eventTone(event.eventType);
              const links = payloadLinks(event.companyId, event.payload);
              const summary = shortPayload(event.payload);

              return (
                <article key={event.id} className="record-card">
                  <div className="record-card-live-head">
                    <span
                      className={`status-chip ${
                        tone === 'error'
                          ? 'status-chip-attention'
                          : tone === 'warn'
                            ? 'status-chip-muted'
                            : ''
                      }`}
                    >
                      <span className={`status-dot ${tone}`} />
                      {humanizeEventType(event.eventType)}
                    </span>
                    <span className="tiny-muted">{formatDateTime(event.createdAt)}</span>
                  </div>

                  <div className="panel-stack">
                    <div className="inline-row">
                      <a className="table-link" href={buildEventsHref({ companyId: event.companyId, window: selectedWindow })}>
                        {event.company?.name || event.companyId}
                      </a>
                    </div>
                    <div className="text-muted">
                      {summary || 'No short summary derived from the payload. Expand details for the raw event body.'}
                    </div>
                  </div>

                  <div className="action-cluster">
                    <a className="button-ghost" href={`/clients/${event.companyId}`}>
                      Open client
                    </a>
                    {links.map((link) => (
                      <a key={link.href} className="button-ghost" href={link.href}>
                        {link.label}
                      </a>
                    ))}
                  </div>

                  <details className="panel-stack">
                    <summary className="details-summary">Raw payload</summary>
                    <pre className="tiny-muted pre-wrap">{JSON.stringify(event.payload, null, 2)}</pre>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </LayoutShell>
  );
}
