import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';
import { safeLoad } from '@/lib/ui-data';
import { bookingNotificationReadiness } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function bookingStatusChipClass(status: ReturnType<typeof bookingNotificationReadiness>['status']) {
  return status === 'ready' ? 'status-chip' : 'status-chip status-chip-attention';
}

export default async function BookingsPage({
  searchParams
}: {
  searchParams?: Promise<{
    companyId?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';
  const now = new Date();
  const selectedCompany = companyId
    ? await safeLoad(
        () =>
          db.company.findUnique({
            where: { id: companyId },
            select: { id: true, name: true, notificationEmail: true, telnyxInboundNumber: true }
          }),
        null
      )
    : null;

  const appointments = companyId
    ? await safeLoad(
        () =>
          db.appointment.findMany({
            where: { companyId },
            select: {
              id: true,
              companyId: true,
              startTime: true,
              createdAt: true,
              contact: {
                select: {
                  name: true,
                  phone: true,
                  conversations: {
                    where: { companyId },
                    select: { id: true },
                    take: 1
                  }
                }
              }
            },
            orderBy: [{ startTime: 'asc' }, { createdAt: 'desc' }],
            take: 100
          }),
        []
      )
    : [];

  const upcomingAppointments = appointments.filter((appointment) => appointment.startTime >= now);
  const pastAppointments = appointments.filter((appointment) => appointment.startTime < now);
  const nextAppointment = upcomingAppointments[0] || null;
  const notificationStatus = bookingNotificationReadiness(selectedCompany?.notificationEmail);
  const manualNotificationBacklog = notificationStatus.status === 'ready' ? 0 : upcomingAppointments.length;
  const nextConversationHref = nextAppointment?.contact?.conversations?.[0]?.id
    ? `/conversations/${nextAppointment.contact.conversations[0].id}`
    : companyId
      ? `/conversations?companyId=${companyId}`
      : '/conversations';

  return (
    <LayoutShell
      title="Bookings"
      description="Keep appointments attached to the right clinic, the right contact, and the right conversation so client notifications stay clean."
      companyId={companyId}
      companyName={selectedCompany?.name || undefined}
      section="bookings"
    >
      <CompanySelectorBar action="/bookings" initialCompanyId={companyId} />

      {!companyId && <div className="empty-state">Choose a company by name to load the booking workspace.</div>}

      {companyId && (
        <section className="panel panel-stack">
          <div className="metric-label">Booking queue</div>
          <div className="company-summary-strip">
            <div className="company-summary-item">
              <span className="key-value-label">Upcoming</span>
              <strong>{upcomingAppointments.length}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Past</span>
              <strong>{pastAppointments.length}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Notification email</span>
              <strong>{selectedCompany?.notificationEmail ? 'Ready' : 'Missing'}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Manual follow-up</span>
              <strong>{manualNotificationBacklog}</strong>
            </div>
          </div>
          {nextAppointment ? (
            <div className="record-subtitle">
              Next appointment: {nextAppointment.contact?.name || 'Unnamed contact'} on {formatDateTime(nextAppointment.startTime)}.
            </div>
          ) : (
            <div className="record-subtitle">No future bookings yet for this company.</div>
          )}
          <div className="record-links">
            <a className="button" href={nextConversationHref}>
              {nextAppointment?.contact?.conversations?.[0]?.id ? 'Open next booking thread' : 'Open conversation queue'}
            </a>
            <a className="button-secondary" href={`/events?companyId=${companyId}`}>
              Review booking events
            </a>
            {notificationStatus.status !== 'ready' && (
              <>
                <a className="button-ghost" href={`/companies#company-${companyId}`}>
                  Fix clinic setup
                </a>
                <a className="button-ghost" href="/diagnostics">
                  Check SMTP
                </a>
              </>
            )}
          </div>
        </section>
      )}

      {companyId && (
        <section className="panel panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Booking readiness</div>
              <h2 className="record-title">What happens after an appointment is booked tonight</h2>
            </div>
            <span className={bookingStatusChipClass(notificationStatus.status)}>
              <strong>Email path</strong> {notificationStatus.label}
            </span>
          </div>
          <div className="key-value-grid">
            <div className="key-value-card">
              <span className="key-value-label">Clinic target</span>
              {selectedCompany?.notificationEmail || 'Missing clinic email'}
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Delivery path</span>
              {notificationStatus.detail}
            </div>
            <div className="key-value-card">
              <span className="key-value-label">Bookings needing manual email follow-up</span>
              {manualNotificationBacklog}
            </div>
          </div>
        </section>
      )}

      {companyId && appointments.length === 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">No bookings yet</div>
          <h2 className="section-title">
            {selectedCompany ? `${selectedCompany.name} does not have any booked appointments yet.` : 'No bookings found yet.'}
          </h2>
          <p className="text-muted">
            Bookings will show up here after the operator moves a live thread into an appointment. Until then, the fastest path is to
            work conversations or add leads that can turn into a booking.
          </p>
          <div className="action-cluster">
            <a className="button" href={`/conversations?companyId=${companyId}`}>
              Open conversations
            </a>
            <a className="button-secondary" href={`/leads?companyId=${companyId}`}>
              Open leads
            </a>
            <a className="button-ghost" href={`/events?companyId=${companyId}`}>
              Review booking events
            </a>
          </div>
        </section>
      )}

      {companyId && upcomingAppointments.length > 0 && (
        <section className="panel panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Upcoming bookings</div>
              <h2 className="record-title">Keep the next appointments tied to the right thread</h2>
            </div>
            <span className="status-chip">
              <strong>Count</strong> {upcomingAppointments.length}
            </span>
          </div>
          <div className="record-grid">
            {upcomingAppointments.map((appointment) => {
              const conversationHref = appointment.contact?.conversations?.[0]?.id
                ? `/conversations/${appointment.contact.conversations[0].id}`
                : `/conversations?companyId=${appointment.companyId}`;

              return (
                <section key={appointment.id} className="record-card">
                  <div className="record-header">
                    <div>
                      <div className="metric-label">Upcoming booking</div>
                      <h2 className="record-title">{appointment.contact?.name || 'Unnamed contact'}</h2>
                      <div className="record-subtitle">{appointment.contact?.phone || 'No phone'}</div>
                    </div>
                    <span className="status-chip">
                      <strong>Starts</strong> {formatDateTime(appointment.startTime)}
                    </span>
                  </div>
                  <div className="status-list">
                    <div className="status-item">
                      <span className="status-label">
                        <span className={`status-dot ${notificationStatus.status === 'ready' ? 'ok' : 'warn'}`} />
                        Clinic notification path
                      </span>
                      <span>{notificationStatus.label}</span>
                    </div>
                    <div className="status-item">
                      <span className="status-label">
                        <span className={`status-dot ${appointment.contact?.conversations?.[0]?.id ? 'ok' : 'warn'}`} />
                        Conversation thread
                      </span>
                      <span>{appointment.contact?.conversations?.[0]?.id ? 'Ready to open' : 'Use queue view'}</span>
                    </div>
                  </div>
                  <div className="inline-row text-muted">
                    <span>Booking ID: {appointment.id}</span>
                    <span>Created: {formatDateTime(appointment.createdAt)}</span>
                  </div>
                  <div className="record-links">
                    <a className="button" href={conversationHref}>
                      {appointment.contact?.conversations?.[0]?.id ? 'Open exact thread' : 'Open conversation queue'}
                    </a>
                    <a className="button-secondary" href={`/events?companyId=${appointment.companyId}`}>
                      View audit trail
                    </a>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}

      {companyId && pastAppointments.length > 0 && (
        <section className="panel panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Past bookings</div>
              <h2 className="record-title">Recent appointments already attached to this clinic</h2>
            </div>
            <span className="status-chip status-chip-muted">
              <strong>Count</strong> {pastAppointments.length}
            </span>
          </div>
          <div className="record-grid">
            {pastAppointments.map((appointment) => {
              const conversationHref = appointment.contact?.conversations?.[0]?.id
                ? `/conversations/${appointment.contact.conversations[0].id}`
                : `/conversations?companyId=${appointment.companyId}`;

              return (
                <section key={appointment.id} className="record-card">
                  <div className="record-header">
                    <div>
                      <div className="metric-label">Past booking</div>
                      <h2 className="record-title">{appointment.contact?.name || 'Unnamed contact'}</h2>
                      <div className="record-subtitle">{appointment.contact?.phone || 'No phone'}</div>
                    </div>
                    <span className="status-chip status-chip-muted">
                      <strong>Started</strong> {formatDateTime(appointment.startTime)}
                    </span>
                  </div>
                  <div className="inline-row text-muted">
                    <span>Booking ID: {appointment.id}</span>
                    <span>Created: {formatDateTime(appointment.createdAt)}</span>
                  </div>
                  <div className="record-links">
                    <a className="button" href={conversationHref}>
                      {appointment.contact?.conversations?.[0]?.id ? 'Open exact thread' : 'Open conversation queue'}
                    </a>
                    <a className="button-secondary" href={`/events?companyId=${appointment.companyId}`}>
                      View audit trail
                    </a>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}
    </LayoutShell>
  );
}
