import { notFound } from 'next/navigation';
import { LeadStatus } from '@prisma/client';
import { LayoutShell } from '@/app/components/LayoutShell';
import { updateCompanyAction } from '@/app/companies/actions';
import { bookConversationAction, sendConversationMessageAction } from '@/app/conversations/[conversationId]/actions';
import { LeadStatusButton } from '@/app/leads/LeadStatusButton';
import { db } from '@/lib/db';
import { buildLifecycleByMessageId, lifecycleForMessage } from '@/lib/message-lifecycle';
import { safeLoad } from '@/lib/ui-data';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { normalizePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

const pageSize = 50;

function parseWindow(value?: string) {
  if (value === '7' || value === '90') {
    return Number(value);
  }

  return 30;
}

function startOfTrailingDays(days: number) {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - (days - 1));
  return value;
}

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

function formatDateTimeLocalInput(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate())
  ].join('-') + `T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function defaultBookingInputValue() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(10, 0, 0, 0);
  return formatDateTimeLocalInput(value);
}

function formatStatusLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function truncatePhone(value?: string | null) {
  if (!value) {
    return '—';
  }

  if (value.length <= 6) {
    return value;
  }

  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function latestLeadActivity(lead: {
  lastRepliedAt: Date | null;
  lastContactedAt: Date | null;
  createdAt: Date;
}) {
  return lead.lastRepliedAt || lead.lastContactedAt || lead.createdAt;
}

function replyRate(replyCount: number, total: number) {
  if (!total) {
    return '—';
  }

  return `${Math.round((replyCount / total) * 100)}%`;
}

function bookingRate(bookingCount: number, total: number) {
  if (!total) {
    return '—';
  }

  return `${Math.round((bookingCount / total) * 100)}%`;
}

function buildBookingFlash(searchParams: {
  booking?: string;
  detail?: string;
  notification?: string;
  notificationDetail?: string;
  confirmation?: string;
  confirmationDetail?: string;
}) {
  const booking = searchParams.booking;
  if (!booking) {
    return null;
  }

  const detail = searchParams.detail;
  const notification = searchParams.notification;
  const notificationDetail = searchParams.notificationDetail;
  const confirmation = searchParams.confirmation;
  const confirmationDetail = searchParams.confirmationDetail;

  if (booking === 'error') {
    return {
      tone: 'error',
      title: 'Booking was not saved',
      body:
        detail === 'startTime_required'
          ? 'Pick an appointment date and time before booking.'
          : detail === 'startTime_in_past'
            ? 'Pick a future appointment time so the booking can be saved.'
            : 'The booking attempt failed before anything new was confirmed.'
    };
  }

  const scheduledText = detail ? formatCompactDateTime(detail) : 'the selected time';
  const notificationText =
    notification === 'sent'
      ? 'client email sent'
      : notification === 'failed'
        ? `client email failed (${notificationDetail || 'unknown error'})`
        : notification === 'skipped'
          ? `client email skipped (${notificationDetail || 'not configured'})`
          : 'client email not attempted';
  const confirmationText =
    confirmation === 'sent'
      ? 'confirmation text sent'
      : confirmation === 'failed'
        ? `confirmation text failed (${confirmationDetail || 'unknown error'})`
        : confirmation === 'skipped'
          ? 'confirmation text skipped'
          : 'confirmation text not attempted';

  if (booking === 'existing') {
    return {
      tone: 'warn',
      title: 'Existing booking kept',
      body: `This contact already had an appointment at ${scheduledText}. No duplicate booking was created. ${confirmationText}; ${notificationText}.`
    };
  }

  return {
    tone: notification === 'failed' || confirmation === 'failed' ? 'warn' : 'ok',
    title: 'Appointment booked',
    body: `Booked for ${scheduledText}. ${confirmationText}; ${notificationText}.`
  };
}

function buildSendFlash(searchParams: { send?: string; detail?: string }) {
  const send = searchParams.send;

  if (!send) {
    return null;
  }

  const detail = searchParams.detail;

  if (send === 'error') {
    return {
      tone: 'error',
      title: 'Text was not sent',
      body:
        detail === 'lead_suppressed'
          ? 'This lead is suppressed, so outbound messaging is blocked.'
          : detail === 'companyId_contactId_conversationId_text_required' || detail === 'companyId_contactId_text_required'
            ? 'The send action was missing required data.'
            : 'The send attempt failed before Telnyx accepted the message.'
    };
  }

  return {
    tone: 'ok',
    title: 'Text sent',
    body:
      detail === 'accepted_by_telnyx'
        ? 'Telnyx accepted the message. Delivery updates will appear in the thread below.'
        : 'The message was logged successfully.'
  };
}

function buildLeadStatusFlash(searchParams: { statusUpdated?: string }) {
  if (!searchParams.statusUpdated) {
    return null;
  }

  return {
    tone: searchParams.statusUpdated === 'SUPPRESSED' ? 'warn' : 'ok',
    title: 'Lead status updated',
    body: `Lead moved to ${formatStatusLabel(searchParams.statusUpdated)}.`
  };
}

function sequenceState(status: string) {
  if (status === 'NEW') {
    return 'Speed-to-Lead step 0 of 3';
  }

  if (status === 'CONTACTED') {
    return 'Speed-to-Lead step 1 of 3';
  }

  if (status === 'REPLIED') {
    return 'Operator active';
  }

  return 'Complete';
}

function buildClientHref(
  id: string,
  base: {
    window: number;
    status?: string;
    source?: string;
    sort?: string;
    dir?: string;
    page?: number;
  },
  update: Record<string, string | number | undefined>
) {
  const params = new URLSearchParams();

  params.set('window', String(update.window ?? base.window));

  const values = {
    status: update.status ?? base.status,
    source: update.source ?? base.source,
    sort: update.sort ?? base.sort,
    dir: update.dir ?? base.dir,
    page: update.page ?? base.page
  };

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }

  if (update.conversationId) {
    params.set('conversationId', String(update.conversationId));
  }

  if (update.leadId) {
    params.set('leadId', String(update.leadId));
  }

  const query = params.toString();
  return query ? `/clients/${id}?${query}` : `/clients/${id}`;
}

export default async function ClientWorkspacePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    window?: string;
    status?: string;
    source?: string;
    sort?: string;
    dir?: string;
    page?: string;
    conversationId?: string;
    leadId?: string;
    notice?: string;
    send?: string;
    detail?: string;
    booking?: string;
    notification?: string;
    notificationDetail?: string;
    confirmation?: string;
    confirmationDetail?: string;
    statusUpdated?: string;
  }>;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};
  const windowDays = parseWindow(query.window);
  const status = query.status || '';
  const selectedLeadStatus = Object.values(LeadStatus).includes(status as LeadStatus)
    ? (status as LeadStatus)
    : undefined;
  const source = query.source || '';
  const sort = query.sort || 'activity';
  const dir = query.dir === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(query.page || '1') || 1);
  const selectedConversationId = query.conversationId || '';
  const selectedLeadId = query.leadId || '';
  const notice = query.notice || '';
  const sendFlash = buildSendFlash(query);
  const bookingFlash = buildBookingFlash(query);
  const leadStatusFlash = buildLeadStatusFlash(query);
  const windowStart = startOfTrailingDays(windowDays);

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        include: {
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

  const clientOptions = await safeLoad(
    () =>
      db.company.findMany({
        select: {
          id: true,
          name: true
        },
        orderBy: { name: 'asc' }
      }),
    [{ id: company.id, name: company.name }]
  );

  const [allWindowLeads, allSources, upcomingBookings, sequenceLeadCounts] = await Promise.all([
    safeLoad(
      () =>
        db.lead.findMany({
          where: {
            companyId: id,
            createdAt: {
              gte: windowStart
            },
            ...(selectedLeadStatus ? { status: selectedLeadStatus } : {}),
            ...(source ? { source } : {})
          },
          include: {
            contact: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 500
        }),
      []
    ),
    safeLoad(
      () =>
        db.lead.findMany({
          where: { companyId: id },
          select: { source: true },
          orderBy: { createdAt: 'desc' },
          take: 250
        }),
      []
    ),
    safeLoad(
      () =>
        db.appointment.findMany({
          where: {
            companyId: id,
            startTime: {
              gte: new Date(),
              lte: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
            }
          },
          include: {
            contact: {
              select: {
                name: true,
                phone: true
              }
            }
          },
          orderBy: { startTime: 'asc' },
          take: 20
        }),
      []
    ),
    safeLoad(
      () =>
        db.lead.groupBy({
          by: ['status'],
          where: {
            companyId: id,
            createdAt: {
              gte: windowStart
            }
          },
          _count: { _all: true }
        }),
      []
    )
  ]);

  const conversationKeys = Array.from(new Set(allWindowLeads.map((lead) => lead.contactId)));
  const conversations = conversationKeys.length
    ? await safeLoad(
        () =>
          db.conversation.findMany({
            where: {
              companyId: id,
              contactId: { in: conversationKeys }
            },
            select: {
              id: true,
              contactId: true
            }
          }),
        []
      )
    : [];
  const conversationByContactId = new Map(conversations.map((conversation) => [conversation.contactId, conversation.id]));

  const sourceOptions = Array.from(
    new Set(allSources.map((row) => row.source?.trim()).filter((value): value is string => Boolean(value)))
  ).sort((left, right) => left.localeCompare(right));

  const leadCounts = sequenceLeadCounts.reduce(
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

  const sortedLeads = [...allWindowLeads].sort((left, right) => {
    const leftActivity = latestLeadActivity(left).getTime();
    const rightActivity = latestLeadActivity(right).getTime();

    const compare = (() => {
      if (sort === 'name') {
        return (left.contact.name || left.contact.phone || '').localeCompare(right.contact.name || right.contact.phone || '');
      }

      if (sort === 'source') {
        return (left.source || '').localeCompare(right.source || '');
      }

      if (sort === 'status') {
        return left.status.localeCompare(right.status);
      }

      return leftActivity - rightActivity;
    })();

    return dir === 'asc' ? compare : compare * -1;
  });

  const totalPages = Math.max(1, Math.ceil(sortedLeads.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedLeads = sortedLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagedConversationIds = Array.from(
    new Set(
      pagedLeads
        .map((lead) => conversationByContactId.get(lead.contactId))
        .filter((value): value is string => Boolean(value))
    )
  );
  const pagedMessages = pagedConversationIds.length
    ? await safeLoad(
        () =>
          db.message.findMany({
            where: {
              companyId: id,
              conversationId: { in: pagedConversationIds }
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              conversationId: true,
              direction: true,
              externalId: true,
              createdAt: true
            }
          }),
        []
      )
    : [];
  const latestMessageByConversationId = new Map<string, (typeof pagedMessages)[number]>();

  for (const message of pagedMessages) {
    if (!latestMessageByConversationId.has(message.conversationId)) {
      latestMessageByConversationId.set(message.conversationId, message);
    }
  }

  const pagedLifecycleEvents = pagedConversationIds.length
    ? await safeLoad(
        () =>
          db.eventLog.findMany({
            where: {
              companyId: id,
              eventType: {
                in: [
                  'telnyx_message_sent',
                  'telnyx_message_finalized',
                  'telnyx_message_delivery_failed',
                  'telnyx_message_delivery_unconfirmed'
                ]
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 300,
            select: {
              eventType: true,
              createdAt: true,
              payload: true
            }
          }),
        []
      )
    : [];
  const pagedLifecycleByMessageId = buildLifecycleByMessageId(pagedLifecycleEvents);
  const selectedConversation = selectedConversationId
    ? await safeLoad(
        () =>
          db.conversation.findUnique({
            where: { id: selectedConversationId },
            include: {
              contact: true,
              messages: {
                orderBy: { createdAt: 'asc' },
                take: 40
              }
            }
          }),
        null
      )
    : null;
  const selectedLead = selectedLeadId ? allWindowLeads.find((lead) => lead.id === selectedLeadId) || null : null;
  const setupGaps = [
    !hasInboundRouting(company) ? 'Inbound routing number' : null,
    !company.notificationEmail ? 'Client notification email' : null
  ].filter(Boolean) as string[];

  const snapshotCards = [
    { label: 'Leads received', value: String(allWindowLeads.length), detail: `${windowDays}-day window` },
    { label: 'Avg response time', value: '—', detail: 'TODO: needs response-time logging' },
    { label: 'Reply rate', value: replyRate(leadCounts.REPLIED + leadCounts.BOOKED, allWindowLeads.length), detail: 'Replied or booked' },
    { label: 'Bookings created', value: String(leadCounts.BOOKED), detail: `${windowDays}-day window` },
    { label: 'Booking conversion', value: bookingRate(leadCounts.BOOKED, allWindowLeads.length), detail: 'Bookings / leads' }
  ];

  const sequenceRows = [
    {
      name: 'Speed-to-Lead',
      triggered: allWindowLeads.length,
      replied: leadCounts.REPLIED + leadCounts.BOOKED,
      booked: leadCounts.BOOKED,
      enabled: true
    },
    {
      name: 'No-Show Recovery',
      triggered: upcomingBookings.length,
      replied: 0,
      booked: 0,
      enabled: false
    },
    {
      name: 'Dead Lead Reactivation',
      triggered: leadCounts.SUPPRESSED,
      replied: 0,
      booked: 0,
      enabled: false
    },
    {
      name: 'Review Automation',
      triggered: leadCounts.BOOKED,
      replied: 0,
      booked: leadCounts.BOOKED,
      enabled: false
    },
    {
      name: 'VIP Winback',
      triggered: 0,
      replied: 0,
      booked: 0,
      enabled: false
    }
  ];
  const selectedThreadHref = selectedConversation
    ? buildClientHref(
        company.id,
        { window: windowDays, status, source, sort, dir, page: currentPage },
        {
          conversationId: selectedConversation.id,
          leadId: selectedLead?.id || selectedLeadId || undefined
        }
      )
    : '';
  const selectedLeadHref = selectedLead
    ? buildClientHref(
        company.id,
        { window: windowDays, status, source, sort, dir, page: currentPage },
        {
          leadId: selectedLead.id
        }
      )
    : '';
  const selectedConversationLifecycleEvents = selectedConversation
    ? await safeLoad(
        () =>
          db.eventLog.findMany({
            where: {
              companyId: selectedConversation.companyId,
              eventType: {
                in: [
                  'telnyx_message_sent',
                  'telnyx_message_finalized',
                  'telnyx_message_delivery_failed',
                  'telnyx_message_delivery_unconfirmed'
                ]
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: {
              eventType: true,
              createdAt: true,
              payload: true
            }
          }),
        []
      )
    : [];
  const selectedLifecycleByMessageId = buildLifecycleByMessageId(selectedConversationLifecycleEvents);

  return (
    <LayoutShell
      title={company.name}
      description="Delivery workspace for this paying client: leads table first, conversations on the side, sequences and bookings below."
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
    >
      {notice && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Client setup updated.</strong>
          </div>
          <div className="text-muted">The latest routing and notification changes are live in this workspace.</div>
        </section>
      )}

      {sendFlash && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${sendFlash.tone}`} />
            <strong>{sendFlash.title}</strong>
          </div>
          <div className="text-muted">{sendFlash.body}</div>
        </section>
      )}

      {bookingFlash && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${bookingFlash.tone}`} />
            <strong>{bookingFlash.title}</strong>
          </div>
          <div className="text-muted">{bookingFlash.body}</div>
        </section>
      )}

      {leadStatusFlash && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${leadStatusFlash.tone}`} />
            <strong>{leadStatusFlash.title}</strong>
          </div>
          <div className="text-muted">{leadStatusFlash.body}</div>
        </section>
      )}

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Client workspace</div>
            <h2 className="section-title section-title-large">{company.name}</h2>
            <div className="inline-row">
              <span className={`status-chip ${setupGaps.length > 0 ? 'status-chip-attention' : ''}`}>
                <span className={`status-dot ${setupGaps.length > 0 ? 'warn' : 'ok'}`} />
                {setupGaps.length > 0 ? `${setupGaps.length} setup gap${setupGaps.length === 1 ? '' : 's'}` : 'Healthy'}
              </span>
              {setupGaps.length > 0 ? <span className="readiness-pill is-warn">Fix setup before trusting automation</span> : null}
            </div>
          </div>
          <div className="panel-stack" style={{ alignItems: 'flex-end' }}>
            <div className="inline-actions">
              <a className="button-secondary" href={`/diagnostics/clients/${company.id}`}>
                Client Health
              </a>
              <a className="button-secondary" href="#transcript-panel">
                Open Conversations
              </a>
              <a className="button-secondary" href="#bookings">
                View Bookings
              </a>
              <a className="button" href="#setup">
                Edit Setup
              </a>
            </div>
            <form className="context-form is-compact" action="/clients">
              <div className="field-stack context-field">
                <label className="key-value-label" htmlFor="workspace-client-switcher">
                  Switch client
                </label>
                <select id="workspace-client-switcher" className="select-input" name="clientId" defaultValue={company.id}>
                  {clientOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="inline-actions context-form-actions">
                <button type="submit" className="button-secondary">
                  Open client
                </button>
                <span className="context-form-hint tiny-muted">Jump workspaces without backing out.</span>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Performance snapshot</div>
            <h2 className="section-title">Numbers first. No charts yet.</h2>
          </div>
          <div className="filter-bar">
            {[7, 30, 90].map((value) => (
              <a
                key={value}
                className={`filter-chip ${windowDays === value ? 'is-active' : ''}`}
                href={buildClientHref(company.id, { window: windowDays, status, source, sort, dir, page: currentPage }, { window: value, page: 1 })}
              >
                {value} days
              </a>
            ))}
          </div>
        </div>
        <div className="metric-grid">
          {snapshotCards.map((card) => (
            <section key={card.label} className="metric-card">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
              <div className="metric-copy">{card.detail}</div>
            </section>
          ))}
        </div>
      </section>

      <div className="client-workspace-layout">
        <section id="leads" className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Leads table</div>
              <h2 className="section-title">The main work surface for this client.</h2>
            </div>
            <span className="status-chip status-chip-muted">
              <strong>Page</strong> {currentPage} / {totalPages}
            </span>
          </div>

          <form className="workspace-filter-form" action={`/clients/${company.id}`}>
            <input type="hidden" name="window" value={windowDays} />
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-lead-status">
                  Status
                </label>
                <select id="client-lead-status" className="select-input" name="status" defaultValue={status}>
                  <option value="">All statuses</option>
                  {['NEW', 'CONTACTED', 'REPLIED', 'BOOKED', 'SUPPRESSED'].map((value) => (
                    <option key={value} value={value}>
                      {formatStatusLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-lead-source">
                  Source
                </label>
                <select id="client-lead-source" className="select-input" name="source" defaultValue={source}>
                  <option value="">All sources</option>
                  {sourceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-lead-sort">
                  Sort
                </label>
                <select id="client-lead-sort" className="select-input" name="sort" defaultValue={sort}>
                  <option value="activity">Last activity</option>
                  <option value="name">Lead name</option>
                  <option value="source">Source</option>
                  <option value="status">Status</option>
                </select>
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-lead-dir">
                  Direction
                </label>
                <select id="client-lead-dir" className="select-input" name="dir" defaultValue={dir}>
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>
            <div className="workspace-filter-actions">
              <button type="submit" className="button">
                Apply filters
              </button>
              <a className="button-ghost" href={`/clients/${company.id}?window=${windowDays}`}>
                Clear
              </a>
            </div>
          </form>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Phone</th>
                  <th>Source</th>
                  <th>Thread</th>
                  <th>Speed-to-lead</th>
                  <th>Follow-up sequence</th>
                  <th>Status</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {pagedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state">No leads yet in this window.</div>
                    </td>
                  </tr>
                ) : (
                  pagedLeads.map((lead) => {
                    const conversationId = conversationByContactId.get(lead.contactId) || '';
                    const speedLabel = lead.lastRepliedAt ? 'Replied' : lead.lastContactedAt ? 'Sent' : 'None';
                    const latestThreadMessage = conversationId ? latestMessageByConversationId.get(conversationId) || null : null;
                    const latestThreadLifecycle = latestThreadMessage
                      ? lifecycleForMessage(
                          latestThreadMessage,
                          pagedLifecycleByMessageId.get(latestThreadMessage.id) || []
                        )
                      : null;
                    const threadLabel = !conversationId
                      ? 'No thread'
                      : !latestThreadMessage
                        ? 'New thread'
                        : latestThreadMessage.direction === 'INBOUND'
                          ? 'Needs reply'
                          : latestThreadLifecycle?.tone === 'error'
                            ? 'Delivery issue'
                            : latestThreadLifecycle?.tone === 'warn'
                              ? 'Awaiting delivery'
                              : 'Waiting on contact';
                    const href = buildClientHref(
                      company.id,
                      { window: windowDays, status, source, sort, dir, page: currentPage },
                      {
                        conversationId,
                        leadId: lead.id
                      }
                    );

                    return (
                      <tr key={lead.id}>
                        <td>
                          <a className="table-link" href={href}>
                            <strong>{lead.contact.name || 'Unknown lead'}</strong>
                          </a>
                        </td>
                        <td>{truncatePhone(lead.contact.phone)}</td>
                        <td>{lead.source || '—'}</td>
                        <td>
                          <span
                            className={`status-chip ${
                              threadLabel === 'Needs reply' || threadLabel === 'Delivery issue'
                                ? 'status-chip-attention'
                                : threadLabel === 'Waiting on contact' || threadLabel === 'Awaiting delivery' || threadLabel === 'No thread'
                                  ? 'status-chip-muted'
                                  : ''
                            }`}
                            title={latestThreadLifecycle?.detail || 'No conversation activity yet'}
                          >
                            {threadLabel}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`status-chip ${speedLabel === 'None' ? 'status-chip-muted' : ''}`}
                            title={
                              lead.lastRepliedAt
                                ? `Replied ${formatCompactDateTime(lead.lastRepliedAt)}`
                                : lead.lastContactedAt
                                  ? `Sent ${formatCompactDateTime(lead.lastContactedAt)}`
                                  : 'No outbound yet'
                            }
                          >
                            {speedLabel}
                          </span>
                        </td>
                        <td>{sequenceState(lead.status)}</td>
                        <td>{formatStatusLabel(lead.status)}</td>
                        <td>{formatCompactDateTime(latestLeadActivity(lead))}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="inline-actions">
              <a
                className="button-secondary"
                href={buildClientHref(company.id, { window: windowDays, status, source, sort, dir, page: currentPage }, { page: Math.max(1, currentPage - 1) })}
              >
                Previous
              </a>
              <a
                className="button-secondary"
                href={buildClientHref(company.id, { window: windowDays, status, source, sort, dir, page: currentPage }, { page: Math.min(totalPages, currentPage + 1) })}
              >
                Next
              </a>
            </div>
          )}
        </section>

        <aside id="transcript-panel" className="panel panel-stack client-side-panel">
          <div className="metric-label">Conversation thread</div>
          {selectedConversation ? (
            <>
              {(() => {
                const threadPhone = normalizePhone(selectedConversation.contact?.phone || '');
                const lastMessage = selectedConversation.messages[selectedConversation.messages.length - 1] || null;
                const lastLifecycle = lastMessage
                  ? lifecycleForMessage(lastMessage, selectedLifecycleByMessageId.get(lastMessage.id) || [])
                  : null;
                const threadState = !lastMessage
                  ? 'New thread'
                  : lastMessage.direction === 'INBOUND'
                    ? 'Needs reply'
                    : lastLifecycle?.tone === 'error'
                      ? 'Delivery issue'
                      : lastLifecycle?.tone === 'warn'
                        ? 'Awaiting delivery'
                        : 'Waiting on contact';

                return (
                  <>
                    <div className="record-header">
                      <div className="panel-stack">
                        <h2 className="section-title">{selectedConversation.contact?.name || 'Conversation'}</h2>
                        <div className="inline-row">
                          <span
                            className={`status-chip ${
                              threadState === 'Needs reply' || threadState === 'Delivery issue'
                                ? 'status-chip-attention'
                                : threadState === 'Waiting on contact' || threadState === 'Awaiting delivery'
                                  ? 'status-chip-muted'
                                  : ''
                            }`}
                          >
                            <strong>Queue</strong> {threadState}
                          </span>
                          <span className="status-chip status-chip-muted">
                            <strong>Messages</strong> {selectedConversation.messages.length}
                          </span>
                          {lastLifecycle ? (
                            <span
                              className={`status-chip ${
                                lastLifecycle.tone === 'error'
                                  ? 'status-chip-attention'
                                  : lastLifecycle.tone === 'warn' || lastLifecycle.tone === 'muted'
                                    ? 'status-chip-muted'
                                    : ''
                              }`}
                            >
                              <span
                                className={`status-dot ${
                                  lastLifecycle.tone === 'error'
                                    ? 'error'
                                    : lastLifecycle.tone === 'warn'
                                      ? 'warn'
                                      : lastLifecycle.tone === 'muted'
                                        ? 'warn'
                                        : 'ok'
                                }`}
                              />
                              {lastLifecycle.label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="inline-actions">
                        {threadPhone && (
                          <>
                            <a className="button-secondary" href={`tel:${threadPhone}`}>
                              Call
                            </a>
                            <a className="button-secondary" href={`sms:${threadPhone}`}>
                              Open SMS
                            </a>
                          </>
                        )}
                        {selectedLead ? (
                          <a className="button-ghost" href={`/leads/${selectedLead.id}`}>
                            Lead record
                          </a>
                        ) : null}
                        <a className="button-ghost" href={`/conversations/${selectedConversation.id}`}>
                          Full thread
                        </a>
                      </div>
                    </div>

                    <div className="key-value-grid">
                      <div className="key-value-card">
                        <span className="key-value-label">Phone</span>
                        {selectedConversation.contact?.phone || 'No phone'}
                      </div>
                      <div className="key-value-card">
                        <span className="key-value-label">Last message</span>
                        {lastMessage ? formatCompactDateTime(lastMessage.createdAt) : 'No messages yet'}
                      </div>
                      <div className="key-value-card">
                        <span className="key-value-label">Conversation ID</span>
                        <span className="tiny-muted">{selectedConversation.id}</span>
                      </div>
                    </div>

                    <div className="client-panel-actions-grid">
                      <form action={sendConversationMessageAction} className="panel panel-stack">
                        <div className="metric-label">Quick reply</div>
                        <input type="hidden" name="companyId" value={selectedConversation.companyId} />
                        <input type="hidden" name="contactId" value={selectedConversation.contactId} />
                        <input type="hidden" name="conversationId" value={selectedConversation.id} />
                        <input type="hidden" name="returnTo" value={selectedThreadHref} />
                        <textarea
                          name="text"
                          placeholder="Write the next outbound text"
                          className="text-area"
                          rows={3}
                        />
                        <button type="submit" className="button">
                          Send text
                        </button>
                      </form>

                      <form action={bookConversationAction} className="panel panel-stack">
                        <div className="metric-label">Quick book</div>
                        <input type="hidden" name="companyId" value={selectedConversation.companyId} />
                        <input type="hidden" name="contactId" value={selectedConversation.contactId} />
                        <input type="hidden" name="conversationId" value={selectedConversation.id} />
                        <input type="hidden" name="returnTo" value={selectedThreadHref} />
                        <div className="field-stack">
                          <label className="key-value-label" htmlFor="client-workspace-start-time">
                            Appointment date and time
                          </label>
                          <input
                            id="client-workspace-start-time"
                            type="datetime-local"
                            name="startTime"
                            className="text-input"
                            defaultValue={defaultBookingInputValue()}
                            min={formatDateTimeLocalInput(new Date())}
                            step={900}
                            required
                          />
                        </div>
                        <button type="submit" className="button-secondary">
                          Book and notify
                        </button>
                      </form>

                      {selectedLead ? (
                        <section className="panel panel-stack">
                          <div className="metric-label">Quick status</div>
                          <div className="inline-actions inline-actions-wrap">
                            <LeadStatusButton
                              leadId={selectedLead.id}
                              companyId={selectedLead.companyId}
                              status="CONTACTED"
                              label="Mark contacted"
                              returnTo={selectedThreadHref}
                            />
                            <LeadStatusButton
                              leadId={selectedLead.id}
                              companyId={selectedLead.companyId}
                              status="REPLIED"
                              label="Mark replied"
                              returnTo={selectedThreadHref}
                            />
                            <LeadStatusButton
                              leadId={selectedLead.id}
                              companyId={selectedLead.companyId}
                              status="BOOKED"
                              label="Mark booked"
                              returnTo={selectedThreadHref}
                            />
                            <LeadStatusButton
                              leadId={selectedLead.id}
                              companyId={selectedLead.companyId}
                              status="SUPPRESSED"
                              label="Suppress"
                              returnTo={selectedThreadHref}
                            />
                          </div>
                        </section>
                      ) : null}
                    </div>

                  </>
                );
              })()}
              <div className="message-thread">
                {selectedConversation.messages.length === 0 ? (
                  <div className="empty-state">This thread has no messages yet.</div>
                ) : (
                  selectedConversation.messages.map((message) => {
                    const lifecycle = lifecycleForMessage(
                      message,
                      selectedLifecycleByMessageId.get(message.id) || []
                    );

                    return (
                      <div key={message.id} className={`message-row${message.direction === 'OUTBOUND' ? ' outbound' : ''}`}>
                        <div className={`message-bubble${message.direction === 'OUTBOUND' ? ' outbound' : ''}`}>
                          <div className="message-meta" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <span>
                              {message.direction} • {formatCompactDateTime(message.createdAt)}
                            </span>
                            <span
                              className={`status-chip ${
                                lifecycle.tone === 'error'
                                  ? 'status-chip-attention'
                                  : lifecycle.tone === 'warn' || lifecycle.tone === 'muted'
                                    ? 'status-chip-muted'
                                    : ''
                              }`}
                            >
                              <span
                                className={`status-dot ${
                                  lifecycle.tone === 'error'
                                    ? 'error'
                                    : lifecycle.tone === 'warn'
                                      ? 'warn'
                                      : lifecycle.tone === 'muted'
                                        ? 'warn'
                                        : 'ok'
                                }`}
                              />
                              {lifecycle.label}
                            </span>
                          </div>
                          <div className="pre-wrap">{message.content}</div>
                          <div className="tiny-muted">{lifecycle.detail}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : selectedLead ? (
            <>
              <h2 className="section-title">{selectedLead.contact.name || 'Lead selected'}</h2>
              <div className="key-value-grid">
                <div className="key-value-card">
                  <span className="key-value-label">Phone</span>
                  {selectedLead.contact.phone || 'No phone'}
                </div>
                <div className="key-value-card">
                  <span className="key-value-label">Lead status</span>
                  {formatStatusLabel(selectedLead.status)}
                </div>
                <div className="key-value-card">
                  <span className="key-value-label">Last activity</span>
                  {formatCompactDateTime(latestLeadActivity(selectedLead))}
                </div>
              </div>
              <div className="inline-actions">
                {normalizePhone(selectedLead.contact.phone || '') ? (
                  <>
                    <a className="button-secondary" href={`tel:${normalizePhone(selectedLead.contact.phone || '')}`}>
                      Call
                    </a>
                    <a className="button-secondary" href={`sms:${normalizePhone(selectedLead.contact.phone || '')}`}>
                      Open SMS
                    </a>
                  </>
                ) : null}
                <a className="button-ghost" href={`/leads/${selectedLead.id}`}>
                  Open lead
                </a>
              </div>
              <form action={sendConversationMessageAction} className="panel panel-stack">
                <div className="metric-label">Start first text</div>
                <input type="hidden" name="companyId" value={company.id} />
                <input type="hidden" name="contactId" value={selectedLead.contactId} />
                <input type="hidden" name="returnTo" value={selectedLeadHref} />
                <textarea
                  name="text"
                  placeholder="Send the first outbound text and open the thread here"
                  className="text-area"
                  rows={3}
                />
                <button type="submit" className="button">
                  Create thread and send
                </button>
              </form>
              <section className="panel panel-stack">
                <div className="metric-label">Quick status</div>
                <div className="inline-actions inline-actions-wrap">
                  <LeadStatusButton
                    leadId={selectedLead.id}
                    companyId={selectedLead.companyId}
                    status="CONTACTED"
                    label="Mark contacted"
                    returnTo={selectedLeadHref}
                  />
                  <LeadStatusButton
                    leadId={selectedLead.id}
                    companyId={selectedLead.companyId}
                    status="REPLIED"
                    label="Mark replied"
                    returnTo={selectedLeadHref}
                  />
                  <LeadStatusButton
                    leadId={selectedLead.id}
                    companyId={selectedLead.companyId}
                    status="BOOKED"
                    label="Mark booked"
                    returnTo={selectedLeadHref}
                  />
                  <LeadStatusButton
                    leadId={selectedLead.id}
                    companyId={selectedLead.companyId}
                    status="SUPPRESSED"
                    label="Suppress"
                    returnTo={selectedLeadHref}
                  />
                </div>
              </section>
              <div className="empty-state">
                No conversation thread exists for this lead yet. When Telnyx creates one, it will open here.
              </div>
            </>
          ) : (
            <div className="empty-state">Click a lead row to keep the table visible and open the thread on the right.</div>
          )}
        </aside>
      </div>

      <section id="sequences" className="panel panel-stack">
        <div className="metric-label">Active sequences</div>
        <h2 className="section-title">Display only for now.</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sequence</th>
                <th>Triggered</th>
                <th>Replied</th>
                <th>Booked</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {sequenceRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.triggered}</td>
                  <td>{row.replied}</td>
                  <td>{row.booked}</td>
                  <td>
                    <span className={`status-chip ${row.enabled ? '' : 'status-chip-muted'}`}>{row.enabled ? 'On' : 'Off'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="bookings" className="panel panel-stack">
        <div className="metric-label">Upcoming bookings</div>
        <h2 className="section-title">Next 14 days.</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Appointment time</th>
                <th>Source sequence</th>
              </tr>
            </thead>
            <tbody>
              {upcomingBookings.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="empty-state">No bookings scheduled in the next 14 days.</div>
                  </td>
                </tr>
              ) : (
                upcomingBookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.contact.name || truncatePhone(booking.contact.phone)}</td>
                    <td>{formatCompactDateTime(booking.startTime)}</td>
                    <td>Speed-to-Lead</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <details id="setup" className="panel panel-stack" open={notice === 'updated'}>
        <summary className="details-summary">
          Client setup {setupGaps.length > 0 ? `(${setupGaps.join(', ')})` : '(ready)'}
        </summary>
        <div className="panel-stack">
          {setupGaps.length > 0 && (
            <div className="readiness-pills">
              {setupGaps.map((gap) => (
                <span key={gap} className="readiness-pill is-warn">
                  {gap}
                </span>
              ))}
            </div>
          )}
          <form action={updateCompanyAction} className="panel-stack">
            <input type="hidden" name="companyId" value={company.id} />
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-name">
                  Client name
                </label>
                <input id="client-name" className="text-input" name="name" defaultValue={company.name} />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-notification">
                  Notification email
                </label>
                <input
                  id="client-notification"
                  className="text-input"
                  name="notificationEmail"
                  defaultValue={company.notificationEmail || ''}
                  placeholder="appointments@client.com"
                />
              </div>
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="client-inbound">
                Telnyx inbound number(s)
              </label>
              <textarea
                id="client-inbound"
                className="text-area"
                name="telnyxInboundNumber"
                defaultValue={allInboundNumbers(company).join('\n')}
                rows={3}
              />
            </div>
            <div className="inline-actions">
              <button type="submit" className="button">
                Save setup
              </button>
            </div>
          </form>
        </div>
      </details>
    </LayoutShell>
  );
}
