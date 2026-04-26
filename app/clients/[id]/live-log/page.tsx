import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

const SETUP_EVENT_TYPES = [
  'client_crm_setup_updated',
  'client_telnyx_setup_updated',
  'client_calendar_setup_updated',
  'client_signup_received',
  'client_signup_approved',
  'client_onboarding_received'
] as const;

type EventTone = 'ok' | 'warn' | 'error';
type EventAccent = 'violet' | 'green' | 'amber' | 'blue' | 'pink' | 'red';

function formatCompactDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return '-';
  }

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

  if (deltaMs < hourMs) {
    const minutes = Math.max(1, Math.round(deltaMs / minuteMs));
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }

  if (deltaMs < dayMs) {
    const hours = Math.max(1, Math.round(deltaMs / hourMs));
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }

  const days = Math.max(1, Math.round(deltaMs / dayMs));
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
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

function eventCategory(eventType: string) {
  const value = eventType.toLowerCase();

  if (value.startsWith('client_')) {
    return 'Setup';
  }

  if (value.startsWith('telnyx_') || value === 'message_received' || value.startsWith('operator_messaging')) {
    return 'Webhook';
  }

  if (value.startsWith('booking_') || value.startsWith('appointment_')) {
    return 'Calendar';
  }

  if (value.startsWith('review_')) {
    return 'Reviews';
  }

  if (value.startsWith('workflow_')) {
    return 'Workflow';
  }

  if (value.startsWith('crm_')) {
    return 'CRM';
  }

  if (value.includes('message') || value.includes('conversation')) {
    return 'Messaging';
  }

  return 'API';
}

function resolveEventPresentation(eventType: string, payload: unknown): {
  tone: EventTone;
  accent: EventAccent;
} {
  const value = eventType.toLowerCase();
  const record = payloadRecord(payload);
  const deliveryStatus = typeof record?.deliveryStatus === 'string' ? record.deliveryStatus.toLowerCase() : '';
  const notificationStatus = typeof record?.notificationStatus === 'string' ? record.notificationStatus.toLowerCase() : '';
  const confirmationStatus = typeof record?.confirmationStatus === 'string' ? record.confirmationStatus.toLowerCase() : '';

  if (
    value === 'telnyx_message_delivery_failed' ||
    value === 'operator_messaging_test_failed' ||
    value === 'booking_confirmation_failed' ||
    value === 'booking_details_request_failed' ||
    value.includes('failed') ||
    value.includes('error') ||
    deliveryStatus === 'sending_failed' ||
    deliveryStatus === 'delivery_failed' ||
    notificationStatus === 'failed' ||
    confirmationStatus === 'failed'
  ) {
    return { tone: 'error', accent: 'red' };
  }

  if (
    value === 'telnyx_message_delivery_unconfirmed' ||
    value.includes('skipped') ||
    value.includes('duplicate') ||
    value.includes('missing') ||
    value.includes('unconfirmed')
  ) {
    return { tone: 'warn', accent: 'amber' };
  }

  if (value.startsWith('telnyx_') || value.includes('message') || value.includes('review')) {
    return { tone: 'ok', accent: 'blue' };
  }

  if (value.startsWith('client_')) {
    return { tone: 'ok', accent: 'violet' };
  }

  if (value.startsWith('booking_') || value.startsWith('appointment_')) {
    return { tone: 'ok', accent: 'green' };
  }

  if (value.startsWith('workflow_')) {
    return { tone: 'ok', accent: 'pink' };
  }

  return { tone: 'ok', accent: 'violet' };
}

function shortPayload(eventType: string, payload: unknown) {
  const record = payloadRecord(payload);

  if (!record) {
    return null;
  }

  const value = eventType.toLowerCase();

  if (value === 'client_telnyx_setup_updated') {
    const parts = [
      stringValue(record.phoneNumber) ? `line ${String(record.phoneNumber)}` : null,
      stringValue(record.webhookUrl) ? `webhook saved` : null,
      stringValue(record.automationUrl) ? `workflow target saved` : null
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

  if (value === 'client_crm_setup_updated') {
    const parts = [
      stringValue(record.crmProvider) ? `provider ${String(record.crmProvider)}` : null,
      record.hasApiKey ? 'credentials saved' : 'credentials cleared'
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

  if (value === 'client_calendar_setup_updated') {
    const parts = [
      stringValue(record.platformName) ? `platform ${String(record.platformName)}` : null,
      stringValue(record.googleCalendarId) ? `google calendar linked` : null,
      stringValue(record.externalCalendarId) ? `external calendar linked` : null,
      record.syncTestPassed ? 'sync test passed' : null
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

  if (value === 'client_signup_received' || value === 'client_onboarding_received') {
    const parts = [
      stringValue(record.contactName) ? `contact ${String(record.contactName)}` : null,
      stringValue(record.notificationEmail) ? `email ${String(record.notificationEmail)}` : null,
      stringValue(record.phone) ? `phone ${String(record.phone)}` : null
    ].filter(Boolean) as string[];

    return parts.join(' · ');
  }

  const parts = [
    stringValue(record.reason),
    stringValue(record.detail),
    stringValue(record.deliveryStatus) ? `delivery ${String(record.deliveryStatus)}` : null,
    stringValue(record.notificationStatus) ? `email ${String(record.notificationStatus)}` : null,
    stringValue(record.confirmationStatus) ? `sms ${String(record.confirmationStatus)}` : null,
    stringValue(record.query) ? `query ${String(record.query)}` : null,
    stringValue(record.phone) ? `phone ${String(record.phone)}` : null,
    stringValue(record.contactPhone) ? `contact ${String(record.contactPhone)}` : null,
    record.contactId ? `contact ${String(record.contactId).slice(-6)}` : null,
    record.leadId ? `lead ${String(record.leadId).slice(-6)}` : null,
    record.conversationId ? `thread ${String(record.conversationId).slice(-6)}` : null,
    record.appointmentId ? `appointment ${String(record.appointmentId).slice(-6)}` : null
  ].filter(Boolean) as string[];

  return parts.length > 0 ? parts.join(' · ') : null;
}

function payloadLinks(companyId: string, payload: unknown) {
  const record = payloadRecord(payload);

  if (!record) {
    return [];
  }

  return [
    record.conversationId
      ? {
          href: `/conversations/${String(record.conversationId)}`,
          label: 'Open thread'
        }
      : null,
    record.leadId
      ? {
          href: `/leads?leadId=${String(record.leadId)}`,
          label: 'Open lead'
        }
      : null,
    record.appointmentId
      ? {
          href: `/clients/${companyId}/workflow`,
          label: 'Open workflow'
        }
      : null
  ].filter(Boolean) as Array<{ href: string; label: string }>;
}

export default async function ClientLiveLogPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          crmProvider: true,
          notificationEmail: true,
          telnyxInboundNumber: true,
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

  const [recentEvents, setupChanges30d] = await Promise.all([
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            companyId: id,
            NOT: [{ eventType: { startsWith: 'lead_' } }, { eventType: { startsWith: 'prospect_' } }]
          },
          orderBy: { createdAt: 'desc' },
          take: 20
        }),
      []
    ),
    safeLoad(
      () =>
        db.eventLog.count({
          where: {
            companyId: id,
            createdAt: { gte: last30Days },
            eventType: { in: [...SETUP_EVENT_TYPES] }
          }
        }),
      0
    )
  ]);

  const inboundNumbers = [
    ...(company.telnyxInboundNumber ? [company.telnyxInboundNumber] : []),
    ...company.telnyxInboundNumbers.map((entry) => entry.number)
  ];
  const attentionEvents24h = recentEvents.filter((event) => {
    if (event.createdAt < last24Hours) {
      return false;
    }

    return resolveEventPresentation(event.eventType, event.payload).tone !== 'ok';
  });
  const criticalEvents24h = recentEvents.filter((event) => {
    if (event.createdAt < last24Hours) {
      return false;
    }

    return resolveEventPresentation(event.eventType, event.payload).tone === 'error';
  });
  const healthSummary =
    attentionEvents24h.length > 0
      ? `${attentionEvents24h.length} issue${attentionEvents24h.length === 1 ? '' : 's'} in the last 24 hours`
      : 'No recent failures detected';
  const connectedCount = [
    company.crmProvider && company.crmProvider !== 'NONE',
    inboundNumbers.length > 0,
    Boolean(company.notificationEmail)
  ].filter(Boolean).length;
  const setupHealthParts = [
    company.crmProvider && company.crmProvider !== 'NONE' ? `CRM: ${company.crmProvider}` : 'CRM missing',
    inboundNumbers.length > 0 ? 'Phone line ready' : 'Phone line missing',
    company.notificationEmail ? 'Alert email ready' : 'Alert email missing'
  ];

  return (
    <LayoutShell
      title={`${company.name} · Live log`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="live-log" />

      <section className="panel panel-stack">
        <div className="live-log-health-bar">
          <section className="live-log-health-card">
            <div className="metric-label">Failures (24h)</div>
            <div className="live-log-health-value">{criticalEvents24h.length}</div>
            <div className="live-log-health-copy">{healthSummary}</div>
          </section>
          <section className="live-log-health-card">
            <div className="metric-label">Connections</div>
            <div className="live-log-health-value">{connectedCount}/3</div>
            <div className="live-log-health-copy">{setupHealthParts.join(' · ')}</div>
          </section>
          <section className="live-log-health-card">
            <div className="live-log-health-head">
              <div className="metric-label">Setup changes (30d)</div>
              <Link className="button-secondary live-log-health-action" href={`/clients/${company.id}/live-log`}>
                Refresh log
              </Link>
            </div>
            <div className="live-log-health-value">{setupChanges30d}</div>
            <div className="live-log-health-copy">Recent CRM, phone, calendar, or onboarding updates.</div>
          </section>
        </div>
      </section>

      <section className="panel panel-stack">
        {recentEvents.length === 0 ? (
          <div className="empty-state">No webhook or API activity has been recorded for this client yet.</div>
        ) : (
          <div className="record-grid">
            {recentEvents.map((event) => {
              const presentation = resolveEventPresentation(event.eventType, event.payload);
              const summaryLine = shortPayload(event.eventType, event.payload);
              const links = payloadLinks(company.id, event.payload);

              return (
                <article key={event.id} className={`record-card record-card-activity-minimal activity-feed-card activity-feed-card-${presentation.accent}`}>
                  <div className={`activity-feed-icon activity-feed-icon-${presentation.accent}`} aria-hidden="true">
                    <span className="activity-feed-icon-glyph">{presentation.tone === 'error' ? '!' : presentation.tone === 'warn' ? '?' : '>'}</span>
                  </div>

                  <div className="activity-feed-card-main">
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
                      <span className="tiny-muted">{eventCategory(event.eventType)}</span>
                      <span className="tiny-muted">{formatElapsedTime(event.createdAt)}</span>
                    </div>

                    <div className="panel-stack activity-feed-body">
                      <div className="activity-feed-main">
                        <div className="activity-feed-title-row">
                          <strong className="record-card-event-title">{humanizeEventType(event.eventType)}</strong>
                        </div>
                        <div className="text-muted activity-feed-summary">
                          {summaryLine || 'No short summary derived from the payload. Expand details for the raw event body.'}
                        </div>
                        <div className="tiny-muted">
                          {formatCompactDateTime(event.createdAt)} · event {event.id.slice(-8)}
                        </div>
                      </div>
                    </div>

                    <div className="action-cluster">
                      {links.map((link) => (
                        <Link key={link.href} className="button-ghost" href={link.href}>
                          {link.label}
                        </Link>
                      ))}
                    </div>

                    <details className="panel-stack live-log-payload">
                      <summary className="details-summary">Raw payload</summary>
                      <pre
                        className="code-block live-log-code-block"
                        style={{
                          background: 'rgba(12, 10, 28, 0.96)',
                          color: 'rgba(241, 245, 255, 0.94)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)'
                        }}
                      >
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </LayoutShell>
  );
}
