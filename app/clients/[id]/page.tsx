import { notFound } from 'next/navigation';
import { LeadStatus } from '@prisma/client';
import { LayoutShell } from '@/app/components/LayoutShell';
import { updateCompanyAction } from '@/app/companies/actions';
import { bookConversationAction, sendConversationMessageAction } from '@/app/conversations/[conversationId]/actions';
import { LeadStatusButton } from '@/app/leads/LeadStatusButton';
import { db } from '@/lib/db';
import { isDemoLabel } from '@/lib/demo';
import { humanizeIntakeSource } from '@/lib/client-intake';
import {
  buildConversationRoutingObservation,
  buildLifecycleByMessageId,
  lifecycleForMessage
} from '@/lib/message-lifecycle';
import { safeLoad } from '@/lib/ui-data';
import { allInboundNumbers, companyPrimaryInboundNumber, hasInboundRouting } from '@/lib/inbound-numbers';
import { normalizePhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

const pageSize = 50;
const operatorQueueStates = [
  'needs_reply',
  'delivery_issue',
  'awaiting_delivery',
  'waiting_on_contact',
  'no_thread'
] as const;
const operatorQueuePriority = [
  'needs_reply',
  'delivery_issue',
  'no_thread',
  'awaiting_delivery',
  'waiting_on_contact'
] as const;

type OperatorQueueState = (typeof operatorQueueStates)[number];

function parseWindow(value?: string) {
  if (value === '7' || value === '90') {
    return Number(value);
  }

  return 30;
}

function normalizeSearch(value?: string | null) {
  return (value || '').trim().toLowerCase();
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

function formatDurationCompact(ms: number | null) {
  if (!ms || ms <= 0) {
    return '—';
  }

  const totalMinutes = Math.round(ms / 60000);

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function buildClientHealthBanner(options: {
  setupGaps: string[];
  needsReplyCount: number;
  deliveryIssueCount: number;
  awaitingDeliveryCount: number;
}) {
  if (options.setupGaps.length > 0) {
    return {
      tone: 'error' as const,
      label: 'At Risk',
      reason: `${options.setupGaps.join(', ')} ${options.setupGaps.length === 1 ? 'is' : 'are'} still missing.`
    };
  }

  if (options.needsReplyCount > 0) {
    return {
      tone: 'warn' as const,
      label: 'Attention Needed',
      reason: `AI flagged ${options.needsReplyCount} conversation${options.needsReplyCount === 1 ? '' : 's'} needing a human reply.`
    };
  }

  if (options.deliveryIssueCount > 0) {
    return {
      tone: 'warn' as const,
      label: 'Attention Needed',
      reason: `${options.deliveryIssueCount} outbound message${options.deliveryIssueCount === 1 ? '' : 's'} failed delivery and need review.`
    };
  }

  if (options.awaitingDeliveryCount > 0) {
    return {
      tone: 'warn' as const,
      label: 'Attention Needed',
      reason: `${options.awaitingDeliveryCount} recent message${options.awaitingDeliveryCount === 1 ? '' : 's'} are still waiting on carrier confirmation.`
    };
  }

  return {
    tone: 'ok' as const,
    label: 'Healthy',
    reason: 'Everything running smooth.'
  };
}

function parseOperatorQueue(value?: string): OperatorQueueState | undefined {
  return operatorQueueStates.includes(value as OperatorQueueState) ? (value as OperatorQueueState) : undefined;
}

function operatorQueueLabel(value: OperatorQueueState) {
  switch (value) {
    case 'needs_reply':
      return 'Needs reply';
    case 'delivery_issue':
      return 'Delivery issue';
    case 'awaiting_delivery':
      return 'Awaiting delivery';
    case 'waiting_on_contact':
      return 'Waiting on contact';
    case 'no_thread':
      return 'No thread';
    default:
      return value;
  }
}

function operatorQueueDescription(value: OperatorQueueState) {
  switch (value) {
    case 'needs_reply':
      return 'Inbound texts waiting on an operator reply.';
    case 'delivery_issue':
      return 'Outbound texts that failed or need manual attention.';
    case 'awaiting_delivery':
      return 'Recent sends still waiting on final carrier confirmation.';
    case 'waiting_on_contact':
      return 'Open threads where the next move is another touch later.';
    case 'no_thread':
      return 'Leads that still need the first outbound text started.';
    default:
      return 'Queue view';
  }
}

function operatorQueueStateForLead(
  conversationId: string,
  latestThreadMessage: {
    direction: 'INBOUND' | 'OUTBOUND';
    externalId: string | null;
    createdAt: Date;
  } | null,
  latestThreadLifecycle: { tone: 'ok' | 'warn' | 'error' | 'muted' } | null
): OperatorQueueState {
  if (!conversationId) {
    return 'no_thread';
  }

  if (!latestThreadMessage) {
    return 'waiting_on_contact';
  }

  if (latestThreadMessage.direction === 'INBOUND') {
    return 'needs_reply';
  }

  if (latestThreadLifecycle?.tone === 'error') {
    return 'delivery_issue';
  }

  if (latestThreadLifecycle?.tone === 'warn') {
    return 'awaiting_delivery';
  }

  return 'waiting_on_contact';
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
    q?: string;
    queue?: string;
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
    q: update.q ?? base.q,
    queue: update.queue ?? base.queue,
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
    q?: string;
    queue?: string;
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
  const searchQuery = (query.q || '').trim();
  const normalizedSearchQuery = normalizeSearch(query.q);
  const queue = parseOperatorQueue(query.queue);
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
  const weekStart = startOfTrailingDays(7);

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

  const [allWindowLeads, allSources, upcomingBookings, sequenceLeadCounts, intakeEvents, weeklyStats] = await Promise.all([
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
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            companyId: id,
            eventType: {
              in: ['client_signup_received', 'client_onboarding_received']
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 4,
          select: {
            eventType: true,
            createdAt: true,
            payload: true
          }
        }),
      []
    ),
    safeLoad(
      async () => {
        const [newLeadsThisWeek, appointmentsThisWeek, messagesThisWeek] = await Promise.all([
          db.lead.count({
            where: {
              companyId: id,
              createdAt: { gte: weekStart }
            }
          }),
          db.appointment.count({
            where: {
              companyId: id,
              createdAt: { gte: weekStart }
            }
          }),
          db.message.count({
            where: {
              companyId: id,
              createdAt: { gte: weekStart }
            }
          })
        ]);

        return {
          newLeadsThisWeek,
          appointmentsThisWeek,
          messagesThisWeek
        };
      },
      {
        newLeadsThisWeek: 0,
        appointmentsThisWeek: 0,
        messagesThisWeek: 0
      }
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

  const searchedLeads = normalizedSearchQuery
    ? allWindowLeads.filter((lead) => {
        const haystacks = [lead.contact.name, lead.contact.phone, lead.source]
          .map((value) => normalizeSearch(value))
          .filter(Boolean);

        return haystacks.some((value) => value.includes(normalizedSearchQuery));
      })
    : allWindowLeads;
  const sortedLeads = [...searchedLeads].sort((left, right) => {
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

  const allConversationIds = conversations.map((conversation) => conversation.id);
  const latestConversationMessages = allConversationIds.length
    ? await safeLoad(
        () =>
          db.message.findMany({
            where: {
              companyId: id,
              conversationId: { in: allConversationIds }
            },
            orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
            distinct: ['conversationId'],
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
  const latestMessageByConversationId = new Map<string, (typeof latestConversationMessages)[number]>();

  for (const message of latestConversationMessages) {
    if (!latestMessageByConversationId.has(message.conversationId)) {
      latestMessageByConversationId.set(message.conversationId, message);
    }
  }

  const latestLifecycleEvents = allConversationIds.length
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
  const latestLifecycleByMessageId = buildLifecycleByMessageId(latestLifecycleEvents);
  const leadRows = sortedLeads.map((lead) => {
    const conversationId = conversationByContactId.get(lead.contactId) || '';
    const latestThreadMessage = conversationId ? latestMessageByConversationId.get(conversationId) || null : null;
    const latestThreadLifecycle = latestThreadMessage
      ? lifecycleForMessage(
          latestThreadMessage,
          latestLifecycleByMessageId.get(latestThreadMessage.id) || []
        )
      : null;
    const threadStateKey = operatorQueueStateForLead(conversationId, latestThreadMessage, latestThreadLifecycle);
    const speedLabel = lead.lastRepliedAt ? 'Replied' : lead.lastContactedAt ? 'Sent' : 'None';
    const href = buildClientHref(
      company.id,
      { window: windowDays, status, source, q: searchQuery, queue, sort, dir, page },
      {
        conversationId,
        leadId: lead.id
      }
    );

    return {
      lead,
      conversationId,
      latestThreadLifecycle,
      threadStateKey,
      threadLabel: operatorQueueLabel(threadStateKey),
      speedLabel,
      href
    };
  });
  const queueCounts = leadRows.reduce(
    (acc, row) => {
      acc[row.threadStateKey] += 1;
      return acc;
    },
    {
      needs_reply: 0,
      delivery_issue: 0,
      awaiting_delivery: 0,
      waiting_on_contact: 0,
      no_thread: 0
    } as Record<OperatorQueueState, number>
  );
  const nextLeadByQueue = operatorQueueStates.reduce(
    (acc, value) => {
      acc[value] = leadRows.find((row) => row.threadStateKey === value) || null;
      return acc;
    },
    {
      needs_reply: null,
      delivery_issue: null,
      awaiting_delivery: null,
      waiting_on_contact: null,
      no_thread: null
    } as Record<OperatorQueueState, (typeof leadRows)[number] | null>
  );
  const topPriorityQueue = operatorQueuePriority.find((value) => queueCounts[value] > 0);
  const topPriorityRow = topPriorityQueue ? nextLeadByQueue[topPriorityQueue] : null;
  const topPriorityHref =
    topPriorityQueue && topPriorityRow
      ? buildClientHref(
          company.id,
          { window: windowDays, status, source, q: searchQuery, queue, sort, dir, page },
          {
            queue: topPriorityQueue,
            page: 1,
            conversationId: topPriorityRow.conversationId || undefined,
            leadId: topPriorityRow.lead.id
          }
        )
      : '';
  const urgentQueueCount = queueCounts.needs_reply + queueCounts.delivery_issue + queueCounts.no_thread;
  const filteredLeadRows = queue ? leadRows.filter((row) => row.threadStateKey === queue) : leadRows;
  const totalPages = Math.max(1, Math.ceil(filteredLeadRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedLeadRows = filteredLeadRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const defaultSelectedRow = selectedConversationId || selectedLeadId ? null : topPriorityRow || pagedLeadRows[0] || null;
  const effectiveSelectedConversationId = selectedConversationId || defaultSelectedRow?.conversationId || '';
  const effectiveSelectedLeadId = selectedLeadId || defaultSelectedRow?.lead.id || '';
  const selectedConversation = effectiveSelectedConversationId
    ? await safeLoad(
        () =>
          db.conversation.findUnique({
            where: { id: effectiveSelectedConversationId },
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
  const selectedLead = effectiveSelectedLeadId
    ? allWindowLeads.find((lead) => lead.id === effectiveSelectedLeadId) || null
    : null;
  const setupGaps = [
    !hasInboundRouting(company) ? 'Inbound routing number' : null,
    !company.notificationEmail ? 'Client notification email' : null
  ].filter(Boolean) as string[];
  const latestBooking = upcomingBookings[0] || null;
  const latestSignupEvent = intakeEvents.find((event) => event.eventType === 'client_signup_received') || null;
  const latestOnboardingEvent = intakeEvents.find((event) => event.eventType === 'client_onboarding_received') || null;
  const latestSignupPayload =
    latestSignupEvent?.payload && typeof latestSignupEvent.payload === 'object' && !Array.isArray(latestSignupEvent.payload)
      ? (latestSignupEvent.payload as Record<string, unknown>)
      : {};
  const latestOnboardingPayload =
    latestOnboardingEvent?.payload &&
    typeof latestOnboardingEvent.payload === 'object' &&
    !Array.isArray(latestOnboardingEvent.payload)
      ? (latestOnboardingEvent.payload as Record<string, unknown>)
      : {};
  const importedSourceLabel = humanizeIntakeSource(typeof latestSignupPayload.source === 'string' ? latestSignupPayload.source : '');
  const importedContactName =
    typeof latestSignupPayload.contactName === 'string'
      ? latestSignupPayload.contactName
      : typeof latestOnboardingPayload.contactName === 'string'
        ? latestOnboardingPayload.contactName
        : '';
  const importedNotificationEmail =
    typeof latestSignupPayload.notificationEmail === 'string'
      ? latestSignupPayload.notificationEmail
      : typeof latestOnboardingPayload.notificationEmail === 'string'
        ? latestOnboardingPayload.notificationEmail
        : '';

  const weeklySnapshotCards = [
    { label: 'New leads this week', value: String(weeklyStats.newLeadsThisWeek), detail: 'Fresh leads captured for this client' },
    { label: 'Appointments this week', value: String(weeklyStats.appointmentsThisWeek), detail: 'Bookings created in the last 7 days' },
    { label: 'Messages this week', value: String(weeklyStats.messagesThisWeek), detail: 'Sent and received conversations combined' }
  ];
  const clientHealthBanner = buildClientHealthBanner({
    setupGaps,
    needsReplyCount: queueCounts.needs_reply,
    deliveryIssueCount: queueCounts.delivery_issue,
    awaitingDeliveryCount: queueCounts.awaiting_delivery
  });
  const selectedThreadHref = selectedConversation
    ? buildClientHref(
        company.id,
        { window: windowDays, status, source, q: searchQuery, sort, dir, page: currentPage },
        {
          conversationId: selectedConversation.id,
          leadId: selectedLead?.id || effectiveSelectedLeadId || undefined
        }
      )
    : '';
  const selectedLeadHref = selectedLead
    ? buildClientHref(
        company.id,
        { window: windowDays, status, source, q: searchQuery, sort, dir, page: currentPage },
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
  const selectedRoutingObservation = selectedConversation
    ? buildConversationRoutingObservation(selectedConversationLifecycleEvents, selectedConversation.id)
    : null;
  const sharedTelnyxSender = process.env.TELNYX_FROM_NUMBER?.trim() || null;
  const primaryRoutingNumber = companyPrimaryInboundNumber(company);
  const assignedRoutingNumbers = allInboundNumbers(company);
  const activeSenderNumber = primaryRoutingNumber || sharedTelnyxSender;
  const telnyxMode = primaryRoutingNumber
    ? 'dedicated'
    : sharedTelnyxSender
      ? 'shared'
      : 'missing';
  const telnyxTrustCopy =
    telnyxMode === 'dedicated'
      ? 'Replies should route back to this client cleanly.'
      : telnyxMode === 'shared'
        ? 'Outbound SMS is available, but replies are still on the shared fallback sender.'
        : 'Do not trust live SMS here until a shared sender or dedicated inbound number is configured.';

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
            <div className="metric-label">Client health</div>
            <div className="inline-row">
              <h2 className="section-title section-title-large">{company.name}</h2>
              {isDemoLabel(company.name) ? <span className="status-chip status-chip-muted">Demo</span> : null}
            </div>
            <span className={`status-chip ${clientHealthBanner.tone === 'error' || clientHealthBanner.tone === 'warn' ? 'status-chip-attention' : ''}`}>
              <span className={`status-dot ${clientHealthBanner.tone === 'error' ? 'error' : clientHealthBanner.tone === 'warn' ? 'warn' : 'ok'}`} />
              {clientHealthBanner.label}
            </span>
            <div className="record-subtitle">{clientHealthBanner.reason}</div>
          </div>
          <div className="panel-stack" style={{ alignItems: 'flex-end' }}>
            <div className="inline-actions">
              {topPriorityRow ? (
                <a className="button" href={topPriorityHref}>
                  Work next
                </a>
              ) : null}
              <a className="button-secondary" href="#transcript-panel">
                Messages
              </a>
              <a className="button" href="#setup">
                Edit Profile
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
            <div className="metric-label">This week's numbers</div>
            <h2 className="section-title">The three numbers that matter first.</h2>
          </div>
        </div>
        <div className="metric-grid">
          {weeklySnapshotCards.map((card) => (
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
              <div className="metric-label">Client leads</div>
              <h2 className="section-title">Open the next lead, reply fast, and keep the queue moving.</h2>
            </div>
            <div className="inline-actions">
              <span className={`status-chip ${urgentQueueCount > 0 ? 'status-chip-attention' : 'status-chip-muted'}`}>
                <strong>Needs action</strong> {urgentQueueCount}
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Page</strong> {currentPage} / {totalPages}
              </span>
            </div>
          </div>

          <form className="workspace-filter-form" action={`/clients/${company.id}`}>
            <input type="hidden" name="window" value={windowDays} />
            <input type="hidden" name="queue" value={queue || ''} />
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-lead-search">
                  Search
                </label>
                <input
                  id="client-lead-search"
                  className="text-input"
                  name="q"
                  type="search"
                  placeholder="Name, phone, or source"
                  defaultValue={searchQuery}
                />
              </div>
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

          <div className="filter-bar">
            <a
              className={`filter-chip ${!queue ? 'is-active' : ''}`}
              href={buildClientHref(
                company.id,
                { window: windowDays, status, source, q: searchQuery, queue, sort, dir, page: currentPage },
                { queue: '', page: 1 }
              )}
            >
              All leads {leadRows.length}
            </a>
            {operatorQueueStates.map((value) => (
              <a
                key={value}
                className={`filter-chip ${queue === value ? 'is-active' : ''}`}
                href={buildClientHref(
                  company.id,
                  { window: windowDays, status, source, q: searchQuery, queue, sort, dir, page: currentPage },
                  { queue: value, page: 1 }
                )}
              >
                {operatorQueueLabel(value)} {queueCounts[value]}
              </a>
            ))}
          </div>

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
                {pagedLeadRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state">
                        {queue ? `No leads in ${operatorQueueLabel(queue).toLowerCase()} right now.` : 'No leads yet in this window.'}
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedLeadRows.map((row) => {
                    const { lead, latestThreadLifecycle, threadLabel, speedLabel, href } = row;
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
                  href={buildClientHref(
                    company.id,
                    { window: windowDays, status, source, q: searchQuery, queue, sort, dir, page: currentPage },
                    { page: Math.max(1, currentPage - 1) }
                  )}
                >
                  Previous
                </a>
                <a
                  className="button-secondary"
                  href={buildClientHref(
                    company.id,
                    { window: windowDays, status, source, q: searchQuery, queue, sort, dir, page: currentPage },
                    { page: Math.min(totalPages, currentPage + 1) }
                  )}
                >
                  Next
                </a>
            </div>
          )}
        </section>

        <aside id="transcript-panel" className="panel panel-stack client-side-panel">
          <div className="metric-label">Messages</div>
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
                        <span className="key-value-label">Last activity</span>
                        {lastMessage ? formatCompactDateTime(lastMessage.createdAt) : 'No messages yet'}
                      </div>
                    </div>

                    <section className="panel panel-stack">
                      <div className="record-header">
                        <div className="panel-stack">
                          <div className="metric-label">Telnyx sender path</div>
                          <div className="inline-row">
                            <span
                              className={`status-chip ${
                                selectedRoutingObservation?.outboundNumber || selectedRoutingObservation?.inboundNumber
                                  ? ''
                                  : assignedRoutingNumbers.length > 1 || telnyxMode === 'shared'
                                    ? 'status-chip-muted'
                                    : 'status-chip-attention'
                              }`}
                            >
                              <strong>Reply routing</strong>{' '}
                              {selectedRoutingObservation?.inboundNumber || selectedRoutingObservation?.outboundNumber
                                ? 'observed'
                                : assignedRoutingNumbers.length > 1
                                  ? 'client-safe, exact line not observed yet'
                                  : telnyxMode === 'shared'
                                    ? 'shared fallback'
                                    : activeSenderNumber
                                      ? 'single sender context is clear'
                                      : 'sender missing'}
                            </span>
                          </div>
                        </div>
                        <div className="tiny-muted">{telnyxTrustCopy}</div>
                      </div>

                      <div className="key-value-grid">
                        <div className="key-value-card">
                          <span className="key-value-label">Active sender number</span>
                          {activeSenderNumber || 'No sender configured'}
                        </div>
                        <div className="key-value-card">
                          <span className="key-value-label">Observed outbound sender</span>
                          {selectedRoutingObservation?.outboundNumber || 'No outbound thread event observed yet'}
                        </div>
                        <div className="key-value-card">
                          <span className="key-value-label">Observed inbound line</span>
                          {selectedRoutingObservation?.inboundNumber || 'No inbound reply captured on this thread yet'}
                        </div>
                      </div>

                      <div className="panel-stack" style={{ gap: 6 }}>
                        <span className="key-value-label">Assigned client numbers</span>
                        <span className="tiny-muted">
                          {assignedRoutingNumbers.length > 0
                            ? assignedRoutingNumbers.join(', ')
                            : 'No dedicated clinic numbers yet; using shared fallback sender'}
                        </span>
                      </div>
                    </section>

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

      <section id="bookings" className="panel panel-stack">
        <div className="metric-label">Appointments</div>
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
          Client profile {setupGaps.length > 0 ? `(${setupGaps.join(', ')})` : '(source of truth)'}
        </summary>
        <div className="panel-stack">
          <div className="panel-stack" style={{ gap: 8 }}>
            <div className="metric-label">Source of truth</div>
            <div className="page-copy">
              Website signup gets this client into the system. From this point forward, edit the profile here and the CRM becomes the live source of truth for notifications, routing, and how the team works this clinic.
            </div>
            {(latestSignupEvent || latestOnboardingEvent) && (
              <div className="tiny-muted">
                {latestSignupEvent
                  ? `Imported from ${importedSourceLabel || 'website signup'} on ${formatCompactDateTime(latestSignupEvent.createdAt)}`
                  : 'No signup event recorded yet.'}
                {importedContactName ? ` • Contact: ${importedContactName}` : ''}
                {importedNotificationEmail ? ` • Email: ${importedNotificationEmail}` : ''}
                {latestOnboardingEvent ? ` • Onboarding received ${formatCompactDateTime(latestOnboardingEvent.createdAt)}` : ''}
              </div>
            )}
          </div>
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
                Assigned client number(s)
              </label>
              <textarea
                id="client-inbound"
                className="text-area"
                name="telnyxInboundNumber"
                defaultValue={allInboundNumbers(company).join('\n')}
                rows={3}
              />
              <span className="tiny-muted">
                One number can belong to only one client. Add one number per line so replies stay tied to the right workspace.
              </span>
            </div>
            <div className="inline-actions">
              <button type="submit" className="button">
                Save profile
              </button>
            </div>
          </form>
        </div>
      </details>
    </LayoutShell>
  );
}
