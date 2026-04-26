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
  view?: string;
}>;

type NotificationView = 'clients' | 'leads';

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
    related,
    view
  }: {
    companyId?: string;
    eventType?: string;
    window?: string;
    q?: string;
    related?: string;
    view?: NotificationView;
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

  if (view) {
    params.set('view', view);
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

function payloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type EventTone = 'ok' | 'warn' | 'error';
type EventAccent = 'violet' | 'green' | 'amber' | 'blue' | 'pink' | 'red';

function resolveEventPresentation(eventType: string, payload: unknown): {
  tone: EventTone;
  tile: string;
  flair: string | null;
  accent: EventAccent;
  tag: string;
} {
  const value = eventType.toLowerCase();
  const record = payloadRecord(payload);
  const deliveryStatus = typeof record?.deliveryStatus === 'string' ? record.deliveryStatus.toLowerCase() : '';
  const notificationStatus = typeof record?.notificationStatus === 'string' ? record.notificationStatus.toLowerCase() : '';
  const confirmationStatus = typeof record?.confirmationStatus === 'string' ? record.confirmationStatus.toLowerCase() : '';
  const prospectStatus = typeof record?.status === 'string' ? record.status.toLowerCase() : '';
  const outcomeKey = typeof record?.outcomeKey === 'string' ? record.outcomeKey.toLowerCase() : '';

  let tag = 'default';

  if (value === 'prospect_callback_scheduled' || (value === 'prospect_follow_up_updated' && Boolean(record?.nextActionAt))) {
    tag = 'callback';
  } else if (value === 'prospect_bulk_import_completed' || value === 'google_maps_import_completed') {
    tag = 'import';
  } else if (
    value === 'prospect_created' ||
    value === 'lead_created' ||
    value === 'lead_reingested' ||
    value === 'lead_unsuppressed'
  ) {
    tag = 'lead_new';
  } else if (
    value === 'prospect_outcome_updated' &&
    (prospectStatus === 'booked_demo' || prospectStatus === 'closed' || outcomeKey === 'booked' || outcomeKey === 'sold')
  ) {
    tag = 'success';
  } else if (
    value === 'prospect_outcome_updated' &&
    (prospectStatus === 'dead' || outcomeKey === 'do_not_contact')
  ) {
    tag = 'failure';
  } else if (
    value === 'prospect_outcome_updated' ||
    value === 'lead_queue_skipped' ||
    value === 'lead_suppressed'
  ) {
    tag = 'warning';
  } else if (value === 'client_signup_received' || value === 'client_onboarding_received' || (value.includes('signup') && value.includes('received'))) {
    tag = 'signup_received';
  } else if (
    value === 'client_signup_approved' ||
    value === 'appointment_booked' ||
    value === 'booking_confirmation_sent' ||
    value === 'review_request_sent' ||
    value === 'workflow_runs_completed' ||
    value === 'workflow_activated' ||
    value.includes('approved') ||
    value.includes('completed') ||
    value.includes('confirmed') ||
    value.includes('booked')
  ) {
    tag = 'success';
  } else if (
    value === 'telnyx_message_delivery_failed' ||
    value === 'operator_messaging_test_failed' ||
    value === 'booking_confirmation_failed' ||
    value === 'booking_details_request_failed' ||
    value === 'review_score_unparsed' ||
    value.includes('failed') ||
    value.includes('error') ||
    deliveryStatus === 'sending_failed' ||
    deliveryStatus === 'delivery_failed' ||
    notificationStatus === 'failed' ||
    confirmationStatus === 'failed'
  ) {
    tag = 'failure';
  } else if (
    value === 'telnyx_message_delivery_unconfirmed' ||
    value === 'review_request_skipped' ||
    value.includes('suppressed') ||
    value.includes('duplicate') ||
    value.includes('skipped') ||
    value.includes('missing') ||
    value.includes('unconfirmed') ||
    deliveryStatus === 'delivery_unconfirmed'
  ) {
    tag = 'warning';
  } else if (
    value === 'telnyx_message_sent' ||
    value === 'manual_message_sent' ||
    value === 'operator_messaging_test_sent' ||
    value === 'review_request_queued' ||
    value === 'review_request_workflow_updated' ||
    value.includes('message') && value.includes('sent')
  ) {
    tag = 'message_outbound';
  } else if (value === 'message_received') {
    tag = 'message_inbound';
  } else if (value === 'voice_demo_requested' || value.includes('call') || value.includes('phone') || value.includes('voice')) {
    tag = 'call';
  } else if (value.includes('message') || value.includes('conversation') || value.includes('operator') || value.includes('review')) {
    tag = 'message_inbound';
  }

  switch (tag) {
    case 'lead_new':
      return { tag, tone: 'ok', tile: '◎', flair: '🧲', accent: 'violet' };
    case 'import':
      return { tag, tone: 'ok', tile: '↓', flair: '📥', accent: 'blue' };
    case 'callback':
      return { tag, tone: 'warn', tile: '↺', flair: '⏰', accent: 'amber' };
    case 'signup_received':
      return { tag, tone: 'ok', tile: '✦', flair: '🎉', accent: 'violet' };
    case 'success':
      return { tag, tone: 'ok', tile: '✓', flair: '✅', accent: 'green' };
    case 'failure':
      return { tag, tone: 'error', tile: '!', flair: '😕', accent: 'red' };
    case 'warning':
      return { tag, tone: 'warn', tile: '!', flair: '⚠️', accent: 'amber' };
    case 'message_outbound':
      return { tag, tone: 'ok', tile: '➜', flair: '🚀', accent: 'blue' };
    case 'message_inbound':
      return { tag, tone: 'ok', tile: '✉', flair: '💬', accent: 'pink' };
    case 'call':
      return { tag, tone: 'ok', tile: '☎', flair: '📞', accent: 'blue' };
    default:
      return { tag, tone: 'ok', tile: '•', flair: null, accent: 'violet' };
  }
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

function shortPayload(eventType: string, payload: unknown) {
  const record = payloadRecord(payload);

  if (!record) {
    return null;
  }

  const value = eventType.toLowerCase();
  const source = humanizeIntakeSource(typeof record.source === 'string' ? record.source : '');
  const nextActionAt = stringValue(record.nextActionAt);
  const prospectName = stringValue(record.prospectName);
  const phone = stringValue(record.phone);
  const city = stringValue(record.city);
  const callbackLabel = stringValue(record.callbackLabel);
  const status = stringValue(record.status);

  if (value === 'prospect_bulk_import_completed') {
    const parts = [
      record.source ? humanizeEventType(String(record.source)) : 'Bulk import',
      typeof record.added === 'number' ? `${record.added} added` : null,
      typeof record.skippedDuplicates === 'number' ? `${record.skippedDuplicates} duplicates` : null,
      typeof record.skippedInvalid === 'number' ? `${record.skippedInvalid} invalid` : null
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

  if (value === 'google_maps_import_completed') {
    const parts = [
      record.query ? `query ${String(record.query)}` : 'Google Maps import',
      typeof record.imported === 'number' ? `${record.imported} imported` : null,
      typeof record.duplicates === 'number' ? `${record.duplicates} duplicates` : null,
      typeof record.skippedNoPhone === 'number' ? `${record.skippedNoPhone} skipped (no phone)` : null
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

  if (
    value === 'prospect_created' ||
    value === 'prospect_outcome_updated' ||
    value === 'prospect_callback_scheduled' ||
    value === 'prospect_follow_up_updated'
  ) {
    const parts = [
      prospectName || (record.prospectId ? `prospect ${String(record.prospectId).slice(-6)}` : null),
      phone,
      city,
      status ? humanizeEventType(status) : null,
      callbackLabel ? `callback ${callbackLabel}` : null,
      nextActionAt ? `next ${formatDateTime(nextActionAt)}` : null,
      record.lastCallOutcome ? String(record.lastCallOutcome) : null
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

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
  const record = payloadRecord(payload);

  if (!record) {
    return 'unclassified';
  }

  if (record.leadId) {
    return 'lead';
  }

  if (record.prospectId) {
    return 'prospect';
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

function eventTypeLooksLeadWorkspaceRelated(eventType: string) {
  const value = eventType.toLowerCase();

  return value.startsWith('prospect_');
}

function notificationViewForEvent(event: {
  eventType: string;
  companyId: string;
  payload: unknown;
}) {
  if (event.companyId === 'fixyourleads' || relatedRecordType(event.payload) === 'prospect' || eventTypeLooksLeadWorkspaceRelated(event.eventType)) {
    return 'leads' satisfies NotificationView;
  }

  return 'clients' satisfies NotificationView;
}

function labelForNotificationView(view: NotificationView) {
  return view === 'leads' ? 'Lead notifications' : 'Client notifications';
}

function emptyStateCopy(view: NotificationView, hasActiveFilters: boolean) {
  if (view === 'leads') {
    return {
      title: 'No lead notifications yet.',
      body: hasActiveFilters
        ? 'We have not received any lead-tagged events for the current filters.'
        : 'Lead notifications will appear here when a client signup, approval, rejection, or booking event is tagged as lead activity.',
      helper: 'If you expected events here, check your webhook mapping or clear the current filters.'
    };
  }

  return {
    title: hasActiveFilters ? 'No client notifications match the current filters.' : 'No client notifications yet.',
    body: hasActiveFilters
      ? 'Try clearing the filters or broadening the time window to see more activity.'
      : 'Client notifications will appear here when client, booking, or workflow events are recorded.',
    helper: null
  };
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
          href: `/leads?leadId=${String(record.leadId)}`,
          label: 'Open lead'
        }
      : null,
    record.prospectId
      ? {
          href: `/leads?prospectId=${String(record.prospectId)}#selected-lead`,
          label: 'Open prospect'
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
  const selectedView: NotificationView = String(params.view || '').trim() === 'leads' ? 'leads' : 'clients';
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
  const scopedEventTypeRows = eventTypeRows.filter((row) =>
    selectedView === 'leads'
      ? eventTypeLooksLeadWorkspaceRelated(row.eventType)
      : !eventTypeLooksLeadWorkspaceRelated(row.eventType)
  );

  const events = rawEvents.filter((event) => {
    const matchesView = notificationViewForEvent(event) === selectedView;
    const haystack = [
      event.id,
      event.eventType,
      event.companyId,
      event.company?.name || '',
      relatedRecordType(event.payload),
      shortPayload(event.eventType, event.payload) || '',
      payloadString(event.payload)
    ]
      .join(' ')
      .toLowerCase();

    const matchesQuery =
      normalizedTerms.length === 0 ? true : normalizedTerms.every((term) => haystack.includes(term));
    const matchesRelated = selectedRelated ? relatedRecordType(event.payload) === selectedRelated : true;

    return matchesView && matchesQuery && matchesRelated;
  });

  const latestEvent = events[0] || null;
  const visibleEventTypes = new Set(events.map((event) => event.eventType));
  const visibleCompanies = new Set(events.map((event) => event.companyId));
  const activeCompanyName = companies.find((company) => company.id === selectedCompanyId)?.name || null;
  const hasActiveFilters = Boolean(
    selectedCompanyId || selectedEventType || searchQuery || selectedRelated || selectedWindow !== '7d'
  );
  const currentEmptyState = emptyStateCopy(selectedView, hasActiveFilters);
  const liveFeedCategoryLabel = selectedRelated
    ? `${humanizeRelatedRecordType(selectedRelated)} related`
    : selectedEventType
      ? humanizeEventType(selectedEventType)
      : selectedWindow === 'all'
        ? labelForNotificationView(selectedView)
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

      <section className={`panel activity-view-switcher-panel-desktop${compact ? ' activity-view-switcher-panel-compact' : ''}`}>
        <div className="workspace-tab-row activity-view-switcher">
          <Link
            className={`workspace-tab-link${selectedView === 'clients' ? ' is-active' : ''}`}
            href={buildEventsHref(basePath, {
              companyId: selectedCompanyId || undefined,
              window: selectedWindow,
              q: searchQuery || undefined,
              view: 'clients'
            })}
          >
            Clients
          </Link>
          <Link
            className={`workspace-tab-link${selectedView === 'leads' ? ' is-active' : ''}`}
            href={buildEventsHref(basePath, {
              companyId: selectedCompanyId || undefined,
              window: selectedWindow,
              q: searchQuery || undefined,
              view: 'leads'
            })}
          >
            Leads
          </Link>
        </div>
      </section>

      <nav className="activity-mobile-switcher" aria-label="Activity view switcher">
        <div className="activity-mobile-switcher-inner">
          <Link
            className={`workspace-tab-link activity-mobile-switcher-link${selectedView === 'clients' ? ' is-active' : ''}`}
            href={buildEventsHref(basePath, {
              companyId: selectedCompanyId || undefined,
              window: selectedWindow,
              q: searchQuery || undefined,
              view: 'clients'
            })}
          >
            Clients
          </Link>
          <Link
            className={`workspace-tab-link activity-mobile-switcher-link${selectedView === 'leads' ? ' is-active' : ''}`}
            href={buildEventsHref(basePath, {
              companyId: selectedCompanyId || undefined,
              window: selectedWindow,
              q: searchQuery || undefined,
              view: 'leads'
            })}
          >
            Leads
          </Link>
        </div>
      </nav>

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
            <Link className="button-ghost" href={buildEventsHref(basePath, { view: selectedView })}>
              Reset
            </Link>
          </div>

          <form action={basePath} className="workspace-filter-form">
            <input type="hidden" name="view" value={selectedView} />
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
                  {scopedEventTypeRows.map((row) => (
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
                  <option value="prospect">Prospect</option>
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
              <h2 className="section-title">
                {selectedView === 'clients'
                  ? 'Recent client and system notifications.'
                  : 'Recent lead queue and prospect notifications.'}
              </h2>
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
          <div className="empty-state panel-stack">
            <strong>{currentEmptyState.title}</strong>
            <div>{currentEmptyState.body}</div>
            {currentEmptyState.helper ? <div className="tiny-muted">{currentEmptyState.helper}</div> : null}
          </div>
        ) : (
          <div className="record-grid">
            {events.map((event) => {
              const presentation = resolveEventPresentation(event.eventType, event.payload);
              const links = payloadLinks(event.companyId, event.payload);
              const summaryLine = shortPayload(event.eventType, event.payload);
              const related = relatedRecordType(event.payload);

              return (
                <article
                  key={event.id}
                  className={`record-card${compact ? ' record-card-compact record-card-activity-minimal' : ''}${
                    compact ? ` activity-feed-card activity-feed-card-${presentation.accent}` : ''
                  }`}
                >
                  {compact ? (
                    <>
                      <div className={`activity-feed-icon activity-feed-icon-${presentation.accent}`} aria-hidden="true">
                        <span className="activity-feed-icon-glyph">{presentation.tile}</span>
                      </div>

                      <div className="activity-feed-card-main">
                        <div className="record-card-live-head">
                          <Link className="record-card-event-client record-card-event-client-link" href={`/clients/${event.companyId}`}>
                            {event.company?.name || event.companyId}
                          </Link>
                          <span className="activity-feed-time tiny-muted">
                            {formatElapsedTime(event.createdAt)}
                            <span className={`activity-feed-time-dot activity-feed-time-dot-${presentation.accent}`} aria-hidden="true" />
                          </span>
                        </div>

                        <div className="panel-stack activity-feed-body">
                          <div className="activity-feed-main">
                            <div className="activity-feed-title-row">
                              <strong className="record-card-event-title">{humanizeEventType(event.eventType)}</strong>
                              {presentation.flair ? (
                                <span className="activity-feed-title-flair" aria-hidden="true">
                                  {presentation.flair}
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
                            presentation.tone === 'error'
                              ? 'status-chip-attention'
                              : presentation.tone === 'warn'
                                ? 'status-chip-muted'
                                : ''
                          }`}
                        >
                          <span className={`status-dot ${presentation.tone}`} />
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
