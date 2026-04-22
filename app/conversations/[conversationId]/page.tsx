import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { safeLoad } from '@/lib/ui-data';
import { notificationReadiness } from '@/lib/notifications';
import { bookConversationAction, sendConversationMessageAction } from './actions';
import { normalizePhone } from '@/lib/phone';
import { companyPrimaryInboundNumber } from '@/lib/inbound-numbers';
import { buildLifecycleByMessageId, lifecycleForMessage } from '@/lib/message-lifecycle';

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
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

function buildBookingFlash(searchParams: Record<string, string | string[] | undefined>) {
  const booking = Array.isArray(searchParams.booking) ? searchParams.booking[0] : searchParams.booking;
  if (!booking) {
    return null;
  }

  const detail = Array.isArray(searchParams.detail) ? searchParams.detail[0] : searchParams.detail;
  const notification = Array.isArray(searchParams.notification) ? searchParams.notification[0] : searchParams.notification;
  const notificationDetail = Array.isArray(searchParams.notificationDetail)
    ? searchParams.notificationDetail[0]
    : searchParams.notificationDetail;
  const confirmation = Array.isArray(searchParams.confirmation) ? searchParams.confirmation[0] : searchParams.confirmation;
  const confirmationDetail = Array.isArray(searchParams.confirmationDetail)
    ? searchParams.confirmationDetail[0]
    : searchParams.confirmationDetail;

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

  const scheduledText = detail ? formatDateTime(detail) : 'the selected time';
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

function buildSendFlash(searchParams: Record<string, string | string[] | undefined>) {
  const send = Array.isArray(searchParams.send) ? searchParams.send[0] : searchParams.send;

  if (!send) {
    return null;
  }

  const detail = Array.isArray(searchParams.detail) ? searchParams.detail[0] : searchParams.detail;

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

export default async function ConversationDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ conversationId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { conversationId } = await params;
  const loadConversation = () =>
    db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        company: true,
        contact: true,
        messages: { orderBy: { createdAt: 'asc' } }
      }
    });
  const conversation = await safeLoad<Awaited<ReturnType<typeof loadConversation>>>(loadConversation, null);
  const resolvedSearchParams = searchParams ? await searchParams : {};

  if (!conversation) {
    return (
      <LayoutShell title="Conversation Detail" description="The requested conversation could not be found." section="clients">
        <div className="empty-state">Conversation not found.</div>
      </LayoutShell>
    );
  }

  const activeConversation = conversation;
  const sendFlash = buildSendFlash(resolvedSearchParams);
  const bookingFlash = buildBookingFlash(resolvedSearchParams);
  const recentAppointments = await safeLoad(
    () =>
      db.appointment.findMany({
        where: {
          companyId: activeConversation.companyId,
          contactId: activeConversation.contactId
        },
        orderBy: { startTime: 'desc' },
        take: 3
      }),
    []
  );
  const associatedLead = await safeLoad(
      () =>
        db.lead.findFirst({
          where: {
            companyId: activeConversation.companyId,
            contactId: activeConversation.contactId
          },
        select: { id: true }
      }),
    null
  );
  const readiness = notificationReadiness();
  const lastMessage = activeConversation.messages[activeConversation.messages.length - 1] || null;
  const threadState = !lastMessage ? 'New thread' : lastMessage.direction === 'INBOUND' ? 'Needs reply' : 'Waiting on contact';
  const sharedTelnyxSender = process.env.TELNYX_FROM_NUMBER?.trim() || null;
  const primaryRoutingNumber = companyPrimaryInboundNumber(activeConversation.company);
  const activeSenderNumber = primaryRoutingNumber || sharedTelnyxSender;
  const telnyxMode = primaryRoutingNumber
    ? 'dedicated'
    : sharedTelnyxSender
      ? 'shared'
      : 'missing';
  const telnyxTrustCopy =
    telnyxMode === 'dedicated'
      ? 'Replies should route back to this company cleanly.'
      : telnyxMode === 'shared'
        ? 'Outbound SMS is available, but replies are still on the shared fallback sender.'
        : 'Do not trust live SMS here until a shared sender or dedicated inbound number is configured.';
  const normalizedPhone = normalizePhone(activeConversation.contact?.phone || '');
  const conversationLifecycleEvents = await safeLoad(
    () =>
      db.eventLog.findMany({
        where: {
          companyId: activeConversation.companyId,
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
  );
  const lifecycleByMessageId = buildLifecycleByMessageId(conversationLifecycleEvents);

  return (
    <LayoutShell
      title={conversation.contact?.name || 'Conversation'}
      description="Review the full thread, send the next message, and book the appointment from the same screen."
      companyId={activeConversation.companyId}
      companyName={activeConversation.company?.name || undefined}
      section="clients"
    >
      {sendFlash && (
        <div className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${sendFlash.tone}`} />
            <strong>{sendFlash.title}</strong>
          </div>
          <div className="text-muted">{sendFlash.body}</div>
        </div>
      )}

      {bookingFlash && (
        <div className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${bookingFlash.tone}`} />
            <strong>{bookingFlash.title}</strong>
          </div>
          <div className="text-muted">{bookingFlash.body}</div>
        </div>
      )}

      <div className="conversation-layout">
        <section className="panel panel-stack">
          <div className="metric-label">Operator actions</div>
          <h2 className="form-title">Work this lead in one screen.</h2>
          <div className="inline-actions">
            {normalizedPhone && (
              <>
                <a className="button" href={`tel:${normalizedPhone}`}>
                  Call clinic
                </a>
                <a className="button-secondary" href={`sms:${normalizedPhone}`}>
                  Open SMS
                </a>
              </>
            )}
            {associatedLead && (
              <a className="button-ghost" href={`/leads/${associatedLead.id}`}>
                Lead record
              </a>
            )}
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Thread status</div>
              <div className="inline-row">
                <span className={`status-chip ${threadState === 'Needs reply' ? 'status-chip-attention' : threadState === 'Waiting on contact' ? 'status-chip-muted' : ''}`}>
                  <strong>Queue</strong> {threadState}
                </span>
                <span className="status-chip status-chip-muted">
                  <strong>Messages</strong> {conversation.messages.length}
                </span>
              </div>
            </div>
            <div className="tiny-muted">{lastMessage ? formatDateTime(lastMessage.createdAt) : 'No activity yet'}</div>
          </div>

          <div className="key-value-grid">
            <div className="key-value-card">
              <span className="key-value-label">Phone</span>
              {activeConversation.contact?.phone || 'No phone'}
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Client notification email</span>
              {activeConversation.company?.notificationEmail || 'Not configured'}
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Conversation ID</span>
              <span className="tiny-muted">{activeConversation.id}</span>
            </div>
          </div>

          <div className="message-thread">
            {activeConversation.messages.length === 0 && <div className="empty-state">No messages yet.</div>}

            {activeConversation.messages.map((message) => {
              const outbound = message.direction === 'OUTBOUND';
              const lifecycle = lifecycleForMessage(
                message,
                lifecycleByMessageId.get(message.id) || []
              );

              return (
                <div key={message.id} className={`message-row${outbound ? ' outbound' : ''}`}>
                  <div className={`message-bubble${outbound ? ' outbound' : ''}`}>
                    <div className="message-meta" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <span>
                        {message.direction} • {formatDateTime(message.createdAt)}
                      </span>
                      <span className={`status-chip ${
                        lifecycle.tone === 'error'
                          ? 'status-chip-attention'
                          : lifecycle.tone === 'warn' || lifecycle.tone === 'muted'
                            ? 'status-chip-muted'
                            : ''
                      }`}>
                        <span className={`status-dot ${
                          lifecycle.tone === 'error'
                            ? 'error'
                            : lifecycle.tone === 'warn'
                              ? 'warn'
                              : lifecycle.tone === 'muted'
                                ? 'warn'
                                : 'ok'
                        }`} />
                        {lifecycle.label}
                      </span>
                    </div>
                    <div className="pre-wrap">{message.content}</div>
                    <div className="tiny-muted">{lifecycle.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="conversation-sidebar">
          <section className="panel panel-stack sticky-panel">
            <div className="metric-label">Booking status</div>
            <div className="inline-row justify-between">
              <h2 className="form-title">Current booking readiness</h2>
              <div className="status-chip">
                <strong>SMTP</strong> {readiness.smtpUserSet && readiness.smtpPasswordSet ? 'ready' : 'needs setup'}
              </div>
            </div>
            <div className="status-list">
              <div className="status-item">
                <span className="status-label">
                  <span className={`status-dot ${conversation.company?.notificationEmail ? 'ok' : 'warn'}`} />
                  Client notification target
                </span>
                <span>{activeConversation.company?.notificationEmail || 'Missing company email'}</span>
              </div>
              <div className="status-item">
                <span className="status-label">
                  <span className={`status-dot ${activeConversation.contact?.phone ? 'ok' : 'warn'}`} />
                  Contact phone for booking text
                </span>
                <span>{activeConversation.contact?.phone || 'Missing phone'}</span>
              </div>
            </div>
          </section>

          <section className="panel panel-stack">
            <div className="metric-label">Telnyx sender path</div>
            <div className="inline-row justify-between">
              <h2 className="form-title">Active sending number for this workspace</h2>
              <div className={`status-chip ${
                telnyxMode === 'dedicated'
                  ? ''
                  : telnyxMode === 'shared'
                    ? 'status-chip-attention'
                    : 'status-chip-muted'
              }`}>
                <strong>Mode</strong> {telnyxMode === 'dedicated' ? 'dedicated' : telnyxMode === 'shared' ? 'shared fallback' : 'missing'}
              </div>
            </div>
            <div className="status-list">
              <div className="status-item">
                <span className="status-label">
                  <span className={`status-dot ${activeSenderNumber ? 'ok' : 'warn'}`} />
                  Active sender number
                </span>
                <span>{activeSenderNumber || 'No sender configured'}</span>
              </div>
              <div className="status-item">
                <span className="status-label">
                  <span className={`status-dot ${
                    telnyxMode === 'dedicated'
                      ? 'ok'
                      : telnyxMode === 'shared'
                        ? 'warn'
                        : 'error'
                  }`} />
                  Reply routing confidence
                </span>
                <span>{telnyxTrustCopy}</span>
              </div>
            </div>
          </section>

          <form
            action={sendConversationMessageAction}
            className="panel panel-stack"
          >
            <div className="metric-label">Outbound SMS</div>
            <h2 className="form-title">Send the next text</h2>
            <input type="hidden" name="companyId" value={activeConversation.companyId} />
            <input type="hidden" name="contactId" value={activeConversation.contactId} />
            <input type="hidden" name="conversationId" value={activeConversation.id} />
            <textarea
              name="text"
              placeholder="Write the next outbound text"
              className="text-area"
            />
            <div className="text-muted">
              This send will use {activeSenderNumber || 'no configured sender'}.
              {telnyxMode === 'shared' ? ' Replies may still arrive on the shared sender lane until this company gets its own inbound number.' : ''}
            </div>
            <button type="submit" className="button">
              Send text
            </button>
          </form>

          <form
            action={bookConversationAction}
            className="panel panel-stack"
          >
            <div className="metric-label">Booking</div>
            <h2 className="form-title">Book the appointment</h2>
            <input type="hidden" name="companyId" value={activeConversation.companyId} />
            <input type="hidden" name="contactId" value={activeConversation.contactId} />
            <input type="hidden" name="conversationId" value={activeConversation.id} />
            <div className="field-stack">
              <label className="key-value-label" htmlFor="startTime">
                Appointment date and time
              </label>
              <input
                id="startTime"
                type="datetime-local"
                name="startTime"
                className="text-input"
                defaultValue={defaultBookingInputValue()}
                min={formatDateTimeLocalInput(new Date())}
                step={900}
                required
              />
            </div>
            <div className="text-muted">
              Booking will mark the lead as booked, send the contact a confirmation text from {activeSenderNumber || 'the configured sender'}, and notify the client if email is configured.
            </div>
            <button type="submit" className="button-secondary">
              Book and notify
            </button>
          </form>

          <section className="panel panel-stack">
            <div className="metric-label">Appointment history</div>
            <h2 className="form-title">Recent bookings for this contact</h2>
            {recentAppointments.length === 0 ? (
              <div className="empty-state">No bookings yet for this contact.</div>
            ) : (
              <div className="status-list">
                {recentAppointments.map((appointment) => (
                  <div key={appointment.id} className="status-item">
                    <span className="status-label">
                      <span className="status-dot ok" />
                      {formatDateTime(appointment.startTime)}
                    </span>
                    <span className="tiny-muted">{appointment.id}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </LayoutShell>
  );
}
