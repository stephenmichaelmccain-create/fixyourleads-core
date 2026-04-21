import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { safeLoad } from '@/lib/ui-data';
import { notificationReadiness } from '@/lib/notifications';
import { bookConversationAction, sendConversationMessageAction } from './actions';

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

export default async function ConversationDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ conversationId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { conversationId } = await params;
  const conversation = await safeLoad(
    () =>
      db.conversation.findUnique({
        where: { id: conversationId },
        include: {
          company: true,
          contact: true,
          messages: { orderBy: { createdAt: 'asc' } }
        }
      }),
    null
  );
  const resolvedSearchParams = searchParams ? await searchParams : {};

  if (!conversation) {
    return (
      <LayoutShell title="Conversation Detail" description="The requested conversation could not be found." section="conversations">
        <div className="empty-state">Conversation not found.</div>
      </LayoutShell>
    );
  }

  const bookingFlash = buildBookingFlash(resolvedSearchParams);
  const recentAppointments = await safeLoad(
    () =>
      db.appointment.findMany({
        where: {
          companyId: conversation.companyId,
          contactId: conversation.contactId
        },
        orderBy: { startTime: 'desc' },
        take: 3
      }),
    []
  );
  const readiness = notificationReadiness();
  const lastMessage = conversation.messages[conversation.messages.length - 1] || null;
  const threadState = !lastMessage ? 'New thread' : lastMessage.direction === 'INBOUND' ? 'Needs reply' : 'Waiting on contact';

  return (
    <LayoutShell
      title={conversation.contact?.name || 'Conversation'}
      description="Review the full thread, send the next message, and book the appointment from the same screen."
      companyId={conversation.companyId}
      companyName={conversation.company?.name || undefined}
      section="conversations"
    >
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
              {conversation.contact?.phone || 'No phone'}
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Client notification email</span>
              {conversation.company?.notificationEmail || 'Not configured'}
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Conversation ID</span>
              <span className="tiny-muted">{conversation.id}</span>
            </div>
          </div>

          <div className="message-thread">
            {conversation.messages.length === 0 && <div className="empty-state">No messages yet.</div>}

            {conversation.messages.map((message) => {
              const outbound = message.direction === 'OUTBOUND';
              return (
                <div key={message.id} className={`message-row${outbound ? ' outbound' : ''}`}>
                  <div className={`message-bubble${outbound ? ' outbound' : ''}`}>
                    <div className="message-meta">
                      {message.direction} • {formatDateTime(message.createdAt)}
                    </div>
                    <div className="pre-wrap">{message.content}</div>
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
                <span>{conversation.company?.notificationEmail || 'Missing company email'}</span>
              </div>
              <div className="status-item">
                <span className="status-label">
                  <span className={`status-dot ${conversation.contact?.phone ? 'ok' : 'warn'}`} />
                  Contact phone for booking text
                </span>
                <span>{conversation.contact?.phone || 'Missing phone'}</span>
              </div>
            </div>
          </section>

          <form
            action={sendConversationMessageAction}
            className="panel panel-stack"
          >
            <div className="metric-label">Outbound SMS</div>
            <h2 className="form-title">Send the next text</h2>
            <input type="hidden" name="companyId" value={conversation.companyId} />
            <input type="hidden" name="contactId" value={conversation.contactId} />
            <input type="hidden" name="conversationId" value={conversation.id} />
            <textarea
              name="text"
              placeholder="Write the next outbound text"
              className="text-area"
            />
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
            <input type="hidden" name="companyId" value={conversation.companyId} />
            <input type="hidden" name="contactId" value={conversation.contactId} />
            <input type="hidden" name="conversationId" value={conversation.id} />
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
              Booking will mark the lead as booked, send the contact a confirmation text, and notify the client if email is configured.
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
