import { ProspectStatus } from '@prisma/client';
import Link from 'next/link';
import { LayoutShell } from '@/app/components/LayoutShell';
import { LiveFeedControls } from '@/app/events/LiveFeedControls';
import { humanizeIntakeSource } from '@/lib/client-intake';
import { db } from '@/lib/db';
import { hasInboundRouting } from '@/lib/inbound-numbers';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoadDb } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

const windowOptions = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'All time', value: 'all' }
] as const;

export type ActivitySearchParamShape = Promise<{
  companyId?: string;
  eventType?: string;
  window?: string;
  q?: string;
  related?: string;
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

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function buildEventsHref(
  basePath: string,
  {
    companyId,
    eventType,
    window,
    q,
    related
  }: {
    companyId?: string;
    eventType?: string;
    window?: string;
    q?: string;
    related?: string;
  }
) {
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

  if (related) {
    params.set('related', related);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
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

function eventVisual(eventType: string) {
  const value = eventType.toLowerCase();

  if (value.includes('signup') && value.includes('received')) {
    return { tile: '✦', flair: '🎉', accent: 'violet' as const };
  }

  if (
    value.includes('approved') ||
    value.includes('completed') ||
    value.includes('confirmed') ||
    value.includes('booked')
  ) {
    return { tile: '✓', flair: '✅', accent: 'green' as const };
  }

  if (value.includes('failed') || value.includes('error')) {
    return { tile: '!', flair: '😕', accent: 'amber' as const };
  }

  if (value.includes('message') && value.includes('sent')) {
    return { tile: '➜', flair: '🚀', accent: 'blue' as const };
  }

  if (value.includes('message') || value.includes('conversation') || value.includes('operator')) {
    return { tile: '✉', flair: '💬', accent: 'pink' as const };
  }

  if (value.includes('call') || value.includes('phone')) {
    return { tile: '☎', flair: '📞', accent: 'blue' as const };
  }

  return { tile: '•', flair: null, accent: 'violet' as const };
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatElapsedTime(value: Date | string) {
  const target = new Date(value);
  const deltaMs = Date.now() - target.getTime();

  if (!Number.isFinite(deltaMs)) {
    return 'just now';
  }

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;

  if (deltaMs < hourMs) {
    const minutes = Math.max(1, Math.round(deltaMs / minuteMs));
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }

  if (deltaMs < dayMs) {
    const hours = Math.max(1, Math.round(deltaMs / hourMs));
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }

  if (deltaMs < weekMs) {
    const days = Math.max(1, Math.round(deltaMs / dayMs));
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }

  const weeks = Math.max(1, Math.round(deltaMs / weekMs));
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
}

function shortPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const source = humanizeIntakeSource(typeof record.source === 'string' ? record.source : '');

  if (record.onboardingReceivedAt) {
    const parts = [
      source === 'Onboarding' ? 'Onboarding received' : source,
      record.contactName ? `contact ${String(record.contactName)}` : null,
      record.notificationEmail ? `email ${String(record.notificationEmail)}` : null,
      record.telnyxBrandName ? `brand ${String(record.telnyxBrandName)}` : null,
      record.businessType ? `type ${String(record.businessType)}` : null
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

  if (record.signupReceivedAt) {
    const parts = [
      source,
      record.contactName ? `contact ${String(record.contactName)}` : null,
      record.notificationEmail ? `email ${String(record.notificationEmail)}` : null,
      record.phone ? `phone ${String(record.phone)}` : null
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

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

function relatedRecordType(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'unclassified';
  }

  const record = payload as Record<string, unknown>;

  if (record.leadId) {
    return 'lead';
  }

  if (record.conversationId) {
    return 'conversation';
  }

  if (record.appointmentId) {
    return 'appointment';
  }

  if (record.contactId) {
    return 'contact';
  }

  return 'unclassified';
}

function humanizeRelatedRecordType(value: string) {
  if (value === 'unclassified') {
    return 'Unclassified';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
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

async function loadAttentionSummary() {
  const todayStart = startOfDay();
  const tomorrowStart = addDays(todayStart, 1);

  const [allCompanies, conversations, appointmentsToday, overdueProspects] = await Promise.all([
    safeLoadDb(
      () =>
        db.company.findMany({
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            notificationEmail: true,
            telnyxInboundNumber: true,
            telnyxInboundNumbers: {
              select: { number: true }
            }
          }
        }),
      []
    ),
    safeLoadDb(
      () =>
        db.conversation.findMany({
          include: {
            company: {
              select: {
                id: true,
                name: true,
                notificationEmail: true,
                telnyxInboundNumber: true,
                telnyxInboundNumbers: {
                  select: { number: true }
                }
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                direction: true
              }
            }
          }
        }),
      []
    ),
    safeLoadDb(
      () =>
        db.appointment.count({
          where: {
            startTime: {
              gte: todayStart,
              lt: tomorrowStart
            }
          }
        }),
      0
    ),
    safeLoadDb(
      () =>
        db.prospect.count({
          where: {
            companyId: 'fixyourleads',
            status: {
              notIn: [ProspectStatus.CLOSED, ProspectStatus.DEAD]
            },
            nextActionAt: {
              lt: todayStart
            }
          }
        }),
      0
    )
  ]);

  const companies = allCompanies.filter((company) => !isLikelyTestWorkspaceName(company.name));
  const activeCompanyIds = new Set(companies.map((company) => company.id));
  const liveConversations = conversations.filter((conversation) => activeCompanyIds.has(conversation.companyId));
  const unreadClientMessages = liveConversations.filter(
    (conversation) => conversation.messages[0]?.direction === 'INBOUND'
  ).length;
  const clientsNeedingAttention = companies.filter((company) => {
    const hasUnreadConversation = liveConversations.some(
      (conversation) => conversation.companyId === company.id && conversation.messages[0]?.direction === 'INBOUND'
    );

    return !hasInboundRouting(company) || !company.notificationEmail || hasUnreadConversation;
  }).length;

  return {
    unreadClientMessages,
    appointmentsToday,
    overdueProspects,
    clientsNeedingAttention,
    allClear:
      unreadClientMessages === 0 &&
      appointmentsToday === 0 &&
      overdueProspects === 0 &&
      clientsNeedingAttention === 0
  };
}

export async function ActivityPage({
  searchParams,
  basePath = '/admin/activity',
  title = 'Activity Log',
  description = 'See what the system actually did across signups, messages, bookings, and follow-up work.',
  hidePageHeader = false,
  compact = false,
  section = 'activity'
}: {
  searchParams?: ActivitySearchParamShape;
  basePath?: string;
  title?: string;
  description?: string;
  hidePageHeader?: boolean;
  compact?: boolean;
  section?: 'home' | 'clients' | 'leads' | 'system' | 'activity' | 'diagnostics' | 'our-leads';
}) {
  const params = (await searchParams) || {};
  const selectedCompanyId = String(params.companyId || '').trim();
  const selectedEventType = String(params.eventType || '').trim();
  const selectedWindow = String(params.window || '7d').trim() || '7d';
  const searchQuery = String(params.q || '').trim();
  const selectedRelated = String(params.related || '').trim();
  const windowStart = startForWindow(selectedWindow);
  const snapshotAt = new Date().toISOString();

  const [summary, companies, eventTypeRows, rawEvents] = await Promise.all([
    loadAttentionSummary(),
    safeLoadDb(
      () =>
        db.company.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        }),
      []
    ),
    safeLoadDb(
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
    safeLoadDb(
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
  const normalizedTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  const events = rawEvents.filter((event) => {
    const haystack = [
      event.id,
      event.eventType,
      event.companyId,
      event.company?.name || '',
      relatedRecordType(event.payload),
      shortPayload(event.payload) || '',
      payloadString(event.payload)
    ]
      .join(' ')
      .toLowerCase();

    const matchesQuery =
      normalizedTerms.length === 0 ? true : normalizedTerms.every((term) => haystack.includes(term));
    const matchesRelated = selectedRelated ? relatedRecordType(event.payload) === selectedRelated : true;

    return matchesQuery && matchesRelated;
  });

  const latestEvent = events[0] || null;
  const visibleEventTypes = new Set(events.map((event) => event.eventType));
  const visibleCompanies = new Set(events.map((event) => event.companyId));
  const activeCompanyName = companies.find((company) => company.id === selectedCompanyId)?.name || null;
  const liveFeedCategoryLabel = selectedRelated
    ? `${humanizeRelatedRecordType(selectedRelated)} related`
    : selectedEventType
      ? humanizeEventType(selectedEventType)
      : selectedWindow === 'all'
        ? 'All events'
        : `Window ${selectedWindow}`;

  return (
    <LayoutShell
      title={title}
      description={description}
      section={section}
      hidePageHeader={hidePageHeader}
    >
      {!compact ? (
        <>
          <section className={`home-inline-bar${summary.allClear ? '' : ' panel-attention'}`}>
            <div className="home-inline-status">
              <span className={`status-dot ${summary.allClear ? 'ok' : 'warn'}`} />
              <strong>{summary.allClear ? 'Everything is running.' : 'Something needs attention.'}</strong>
            </div>

            <div className="home-inline-metrics">
              <span className="home-inline-pill">
                <span className="metric-label">Unread client messages</span>
                <strong>{summary.unreadClientMessages}</strong>
              </span>
              <span className="home-inline-pill">
                <span className="metric-label">Overdue leads</span>
                <strong>{summary.overdueProspects}</strong>
              </span>
              <span className="home-inline-pill">
                <span className="metric-label">Appointments today</span>
                <strong>{summary.appointmentsToday}</strong>
              </span>
              <span className="home-inline-pill">
                <span className="metric-label">Clients needing attention</span>
                <strong>{summary.clientsNeedingAttention}</strong>
              </span>
            </div>

            <span className="tiny-muted">
              {latestEvent
                ? `Latest event ${humanizeEventType(latestEvent.eventType)} at ${formatDateTime(latestEvent.createdAt)}`
                : 'Waiting for activity'}
            </span>
          </section>

          <LiveFeedControls
            snapshotAt={snapshotAt}
            categoryLabel={liveFeedCategoryLabel}
            visibleCount={events.length}
            latestEventLabel={latestEvent ? humanizeEventType(latestEvent.eventType) : null}
            latestEventAt={latestEvent ? latestEvent.createdAt.toISOString() : null}
            companyName={activeCompanyName}
            compact={compact}
          />
        </>
      ) : null}

      {!compact ? (
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
            <div className="metric-label">Clients in view</div>
            <div className="metric-value">{visibleCompanies.size}</div>
            <div className="metric-copy">Client workspaces represented in this filtered log.</div>
          </section>
          <section className="metric-card panel-stack">
            <div className="metric-label">Latest event</div>
            <div className="metric-value">{latestEvent ? formatDateTime(latestEvent.createdAt) : '—'}</div>
            <div className="metric-copy">
              {latestEvent ? humanizeEventType(latestEvent.eventType) : 'No event in this view yet.'}
            </div>
          </section>
        </div>
      ) : null}

      {!compact ? (
        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Filters</div>
              <h2 className="section-title">Filter the activity without leaving the page.</h2>
            </div>
            <Link className="button-ghost" href={basePath}>
              Reset
            </Link>
          </div>

          <form action={basePath} className="workspace-filter-form">
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="events-company">
                  Client
                </label>
                <select id="events-company" name="companyId" className="select-input" defaultValue={selectedCompanyId}>
                  <option value="">All clients</option>
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
                  placeholder="booking stop, query leadId, delivery_failed"
                />
              </div>

              <div className="field-stack">
                <label className="key-value-label" htmlFor="events-related">
                  Related record
                </label>
                <select id="events-related" name="related" className="select-input" defaultValue={selectedRelated}>
                  <option value="">Any related record</option>
                  <option value="lead">Lead</option>
                  <option value="conversation">Conversation</option>
                  <option value="appointment">Appointment</option>
                  <option value="contact">Contact</option>
                  <option value="unclassified">Unclassified</option>
                </select>
              </div>
            </div>

            <div className="workspace-filter-actions">
              <button type="submit" className="button-secondary">
                Apply filters
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel panel-stack">
        {!compact ? (
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Event feed</div>
              <h2 className="section-title">Recent activity across the live app.</h2>
            </div>
            <div className="action-cluster">
              <Link className="button-ghost" href="/admin/system">
                System Status
              </Link>
              <Link className="button-ghost" href="/diagnostics/workflows">
                Workflow map
              </Link>
            </div>
          </div>
        ) : null}

        {events.length === 0 ? (
          <div className="empty-state">No events match the current filters.</div>
        ) : (
          <div className="record-grid">
            {events.map((event) => {
              const tone = eventTone(event.eventType);
              const links = payloadLinks(event.companyId, event.payload);
              const summaryLine = shortPayload(event.payload);
              const related = relatedRecordType(event.payload);
              const visual = eventVisual(event.eventType);

              return (
                <article
                  key={event.id}
                  className={`record-card${compact ? ' record-card-compact record-card-activity-minimal' : ''}${
                    compact ? ` activity-feed-card activity-feed-card-${visual.accent}` : ''
                  }`}
                >
                  {compact ? (
                    <>
                      <div className={`activity-feed-icon activity-feed-icon-${visual.accent}`} aria-hidden="true">
                        <span className="activity-feed-icon-glyph">{visual.tile}</span>
                      </div>

                      <div className="activity-feed-card-main">
                        <div className="record-card-live-head">
                          <Link className="record-card-event-client record-card-event-client-link" href={`/clients/${event.companyId}`}>
                            {event.company?.name || event.companyId}
                          </Link>
                          <span className="activity-feed-time tiny-muted">
                            {formatElapsedTime(event.createdAt)}
                            <span className={`activity-feed-time-dot activity-feed-time-dot-${visual.accent}`} aria-hidden="true" />
                          </span>
                        </div>

                        <div className="panel-stack activity-feed-body">
                          <div className="activity-feed-main">
                            <div className="activity-feed-title-row">
                              <strong className="record-card-event-title">{humanizeEventType(event.eventType)}</strong>
                              {visual.flair ? (
                                <span className="activity-feed-title-flair" aria-hidden="true">
                                  {visual.flair}
                                </span>
                              ) : null}
                            </div>
                            {summaryLine ? <div className="text-muted activity-feed-summary">{summaryLine}</div> : null}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
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
                        <span className="tiny-muted">{humanizeRelatedRecordType(related)}</span>
                        <span className="tiny-muted">{formatDateTime(event.createdAt)}</span>
                      </div>

                      <div className="panel-stack">
                        <div className="inline-row">
                          <Link
                            className="table-link"
                            href={buildEventsHref(basePath, {
                              companyId: event.companyId,
                              eventType: selectedEventType || undefined,
                              window: selectedWindow,
                              q: searchQuery || undefined,
                              related: selectedRelated || undefined
                            })}
                          >
                            {event.company?.name || event.companyId}
                          </Link>
                        </div>
                        <div className="text-muted">
                          {summaryLine || 'No short summary derived from the payload. Expand details for the raw event body.'}
                        </div>
                      </div>
                    </>
                  )}

                  {!compact ? (
                    <div className="action-cluster">
                      <Link className="button-ghost" href={`/clients/${event.companyId}`}>
                        Open client
                      </Link>
                      {links.map((link) => (
                        <Link key={link.href} className="button-ghost" href={link.href}>
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  {!compact ? (
                    <details className="panel-stack">
                      <summary className="details-summary">Raw payload</summary>
                      <pre className="tiny-muted pre-wrap">{JSON.stringify(event.payload, null, 2)}</pre>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </LayoutShell>
  );
}
