import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
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
            select: { id: true, name: true, notificationEmail: true }
          }),
        null
      )
    : null;

  const appointments = companyId
    ? await safeLoad(
        () =>
          db.appointment.findMany({
            where: { companyId },
            include: {
              contact: true
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
          </div>
          {nextAppointment ? (
            <div className="record-subtitle">
              Next appointment: {nextAppointment.contact?.name || 'Unnamed contact'} on {formatDateTime(nextAppointment.startTime)}.
            </div>
          ) : (
            <div className="record-subtitle">No future bookings yet for this company.</div>
          )}
        </section>
      )}

      {companyId && appointments.length === 0 && (
        <div className="empty-state">No bookings found yet for this company.</div>
      )}

      <div className="record-grid">
        {appointments.map((appointment) => {
          const isUpcoming = appointment.startTime >= now;
          return (
            <section key={appointment.id} className="record-card">
              <div className="record-header">
                <div>
                  <div className="metric-label">{isUpcoming ? 'Upcoming booking' : 'Past booking'}</div>
                  <h2 className="record-title">{appointment.contact?.name || 'Unnamed contact'}</h2>
                  <div className="record-subtitle">{appointment.contact?.phone || 'No phone'}</div>
                </div>
                <span className={`status-chip ${isUpcoming ? '' : 'status-chip-muted'}`}>
                  <strong>{isUpcoming ? 'Starts' : 'Started'}</strong> {formatDateTime(appointment.startTime)}
                </span>
              </div>
              <div className="inline-row text-muted">
                <span>Booking ID: {appointment.id}</span>
                <span>Created: {formatDateTime(appointment.createdAt)}</span>
              </div>
              <div className="record-links">
                <a className="button" href={`/conversations?companyId=${appointment.companyId}`}>
                  Open conversation queue
                </a>
                <a className="button-secondary" href={`/events?companyId=${appointment.companyId}`}>
                  View audit trail
                </a>
              </div>
            </section>
          );
        })}
      </div>
    </LayoutShell>
  );
}
