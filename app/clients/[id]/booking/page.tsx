import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { saveClientCalendarSetupAction } from '@/app/clients/[id]/calendar/actions';
import { db } from '@/lib/db';
import {
  calendarChecklistOrder,
  clientCalendarSetupProgress,
  emptyClientCalendarSetupState,
  parseClientCalendarSetupPayload
} from '@/lib/client-calendar-setup';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
}>;

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

function connectionLabel(mode: string | null) {
  switch (mode) {
    case 'google_oauth':
      return 'Google Calendar via OAuth';
    case 'shared_fyl':
      return 'Shared Fix Your Leads calendar';
    case 'external_booking':
      return 'Existing booking platform';
    case 'manual':
      return 'Manual or not selected';
    default:
      return 'Not selected';
  }
}

function bookingEventDetail(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Booking event logged';
  }

  const record = payload as Record<string, unknown>;
  const detail = record.detail;
  const appointmentId = record.appointmentId;

  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  if (typeof appointmentId === 'string' && appointmentId.trim()) {
    return appointmentId;
  }

  return 'Booking event logged';
}

export default async function ClientBookingPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParamShape;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          createdAt: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [latestSetupEvent, recentSetupEvents, upcomingAppointments, recentBookedEvents] = await Promise.all([
    safeLoad(
      () =>
        db.eventLog.findFirst({
          where: { companyId: id, eventType: 'client_calendar_setup_updated' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true, createdAt: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: { companyId: id, eventType: 'client_calendar_setup_updated' },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { createdAt: true, payload: true }
        }),
      []
    ),
    safeLoad(
      () =>
        db.appointment.findMany({
          where: {
            companyId: id,
            startTime: { gte: new Date() }
          },
          orderBy: { startTime: 'asc' },
          take: 12,
          select: {
            id: true,
            startTime: true,
            status: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            companyId: id,
            eventType: {
              in: ['appointment_booked', 'booking_confirmation_sent', 'booking_confirmation_failed']
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            eventType: true,
            createdAt: true,
            payload: true
          }
        }),
      []
    )
  ]);

  const state = latestSetupEvent ? parseClientCalendarSetupPayload(latestSetupEvent.payload) : emptyClientCalendarSetupState;
  const progress = clientCalendarSetupProgress(state);

  return (
    <LayoutShell
      title={`${company.name} · Booking`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="booking" />

      {query.notice === 'updated' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Booking setup saved.</strong>
          </div>
          <div className="text-muted">The booking sync plan, connection mode, and rollout notes are now stored on this client.</div>
        </section>
      )}

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Booking workspace</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              Fix Your Leads should stay the booking source of truth first, then write bookings into Google Calendar,
              a shared FYL calendar, or an existing booking platform.
            </div>
            <div className="inline-row client-record-chip-row">
              <span className={`readiness-pill ${progress.completed === progress.total ? 'is-ready' : 'is-warn'}`}>
                {progress.completed}/{progress.total} complete
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Mode</strong> {connectionLabel(state.connectionMode)}
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Sync</strong> {state.syncTestPassed ? 'Test passed' : 'Not verified'}
              </span>
            </div>
          </div>
          <div className="workspace-action-rail">
            <a className="button" href={`/clients/${company.id}/operator#bookings`}>
              Open bookings
            </a>
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              View events
            </a>
          </div>
        </div>

        <div className="client-record-stats">
          <div className="client-record-stat">
            <span className="metric-label">Upcoming bookings</span>
            <strong className="workspace-stats-value">{upcomingAppointments.length}</strong>
            <span className="tiny-muted">{upcomingAppointments[0] ? formatCompactDateTime(upcomingAppointments[0].startTime) : 'No future bookings yet'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Google connection</span>
            <strong className="workspace-stats-value">{state.googleOauthConnected ? 'Connected' : 'Not connected'}</strong>
            <span className="tiny-muted">{state.googleAccountEmail || 'No Google account saved'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Fallback calendar</span>
            <strong className="workspace-stats-value">{state.sharedCalendarCreated ? 'Ready' : 'Inactive'}</strong>
            <span className="tiny-muted">{state.sharedCalendarName || 'No shared FYL calendar saved'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Last saved</span>
            <strong className="workspace-stats-value">{formatCompactDateTime(state.updatedAt || latestSetupEvent?.createdAt)}</strong>
            <span className="tiny-muted">This page stores the rollout plan before full OAuth is wired.</span>
          </div>
        </div>
      </section>

      <div className="client-record-layout">
        <div className="panel-stack">
          <section className="panel panel-stack">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Recommended path</div>
                <h3 className="section-title">How we should handle booking sync</h3>
                <div className="record-subtitle">
                  Default to the client&apos;s existing Google Calendar with OAuth. Use a shared FYL calendar only as fallback, and treat
                  external booking software as a later sync target unless the client already lives there.
                </div>
              </div>
            </div>

            <div className="surface-link-grid">
              <div className="surface-link-card">
                <span className="metric-label">Best default</span>
                <strong>Google Calendar via OAuth</strong>
                <span className="tiny-muted">Lowest friction for small businesses and keeps bookings where they already work.</span>
              </div>
              <div className="surface-link-card">
                <span className="metric-label">Fallback</span>
                <strong>Shared Fix Your Leads calendar</strong>
                <span className="tiny-muted">Useful when the client has no usable calendar yet and still needs visibility fast.</span>
              </div>
              <div className="surface-link-card">
                <span className="metric-label">Later integration</span>
                <strong>Existing booking platform</strong>
                <span className="tiny-muted">Good for Jane, Calendly, Vagaro, Boulevard, or Mindbody after the launch path is stable.</span>
              </div>
            </div>
          </section>

          <section className="panel panel-stack">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Booking setup</div>
                <h3 className="section-title">Store the rollout plan</h3>
                <div className="record-subtitle">
                  This tab gives each client a visible booking integration plan now, even before full Google OAuth and writeback are automated.
                </div>
              </div>
            </div>

            <form action={saveClientCalendarSetupAction} className="panel-stack client-profile-form">
              <input type="hidden" name="companyId" value={company.id} />

              <div className="client-profile-section">
                <div className="metric-label">Progress checklist</div>
                <div className="telnyx-checklist-grid">
                  {calendarChecklistOrder.map((item) => (
                    <label key={item.key} className="telnyx-checklist-item">
                      <input type="checkbox" name={item.key} defaultChecked={state[item.key]} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Connection mode</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-connection-mode">
                      Mode
                    </label>
                    <select id="booking-connection-mode" className="select-input" name="connectionMode" defaultValue={state.connectionMode || 'google_oauth'}>
                      <option value="google_oauth">Google Calendar via OAuth</option>
                      <option value="shared_fyl">Shared Fix Your Leads calendar</option>
                      <option value="external_booking">Existing booking platform</option>
                      <option value="manual">Manual / not selected</option>
                    </select>
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-timezone">
                      Timezone
                    </label>
                    <input
                      id="booking-timezone"
                      className="text-input"
                      name="timezone"
                      defaultValue={state.timezone || 'America/Chicago'}
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-duration">
                      Default duration (minutes)
                    </label>
                    <input
                      id="booking-duration"
                      className="text-input"
                      name="defaultDurationMinutes"
                      defaultValue={state.defaultDurationMinutes || '60'}
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Google or shared calendar</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-google-email">
                      Google account email
                    </label>
                    <input
                      id="booking-google-email"
                      className="text-input"
                      name="googleAccountEmail"
                      defaultValue={state.googleAccountEmail || ''}
                      placeholder="owner@client.com"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-google-id">
                      Google Calendar ID
                    </label>
                    <input
                      id="booking-google-id"
                      className="text-input"
                      name="googleCalendarId"
                      defaultValue={state.googleCalendarId || ''}
                      placeholder="client@group.calendar.google.com"
                    />
                  </div>
                </div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-shared-name">
                      Shared FYL calendar name
                    </label>
                    <input
                      id="booking-shared-name"
                      className="text-input"
                      name="sharedCalendarName"
                      defaultValue={state.sharedCalendarName || ''}
                      placeholder="Glow Med Spa - Fix Your Leads"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-share-email">
                      Share with email
                    </label>
                    <input
                      id="booking-share-email"
                      className="text-input"
                      name="sharedCalendarShareEmail"
                      defaultValue={state.sharedCalendarShareEmail || ''}
                      placeholder="frontdesk@client.com"
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Existing booking platform</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-platform-name">
                      Platform name
                    </label>
                    <input
                      id="booking-platform-name"
                      className="text-input"
                      name="externalPlatformName"
                      defaultValue={state.externalPlatformName || ''}
                      placeholder="Calendly, Jane, Vagaro, Boulevard"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-platform-url">
                      Platform URL
                    </label>
                    <input
                      id="booking-platform-url"
                      className="text-input"
                      name="externalPlatformUrl"
                      defaultValue={state.externalPlatformUrl || ''}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-external-id">
                      External calendar or location ID
                    </label>
                    <input
                      id="booking-external-id"
                      className="text-input"
                      name="externalCalendarId"
                      defaultValue={state.externalCalendarId || ''}
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Notes</div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="booking-notes">
                    Booking sync notes
                  </label>
                  <textarea
                    id="booking-notes"
                    className="text-area"
                    name="notes"
                    defaultValue={state.notes || ''}
                    placeholder="Use Google first. If they refuse OAuth, create a shared FYL calendar and invite the front desk."
                    rows={5}
                  />
                </div>
              </div>

              <div className="inline-actions">
                <button type="submit" className="button">
                  Save booking setup
                </button>
              </div>
            </form>
          </section>

          <section className="panel panel-stack">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Upcoming bookings</div>
                <h3 className="section-title">What is already booked</h3>
              </div>
            </div>

            {upcomingAppointments.length === 0 ? (
              <div className="empty-state">No future bookings yet for this client.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Time</th>
                      <th>Status</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingAppointments.map((appointment) => (
                      <tr key={appointment.id}>
                        <td>{appointment.contact.name || 'Unnamed contact'}</td>
                        <td>{formatCompactDateTime(appointment.startTime)}</td>
                        <td>{appointment.status}</td>
                        <td>{appointment.contact.phone || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="client-record-sidebar">
          <section className="panel panel-stack">
            <div className="metric-label">Launch recommendation</div>
            <div className="workspace-list">
              <div className="workspace-list-item">
                <strong>Use Google first</strong>
                <span className="tiny-muted">Best default for most clinics because the front desk already lives there.</span>
              </div>
              <div className="workspace-list-item">
                <strong>Fallback to shared FYL calendar</strong>
                <span className="tiny-muted">Only when they have no workable calendar or refuse OAuth during launch.</span>
              </div>
              <div className="workspace-list-item">
                <strong>External platform later</strong>
                <span className="tiny-muted">Treat existing booking systems as follow-on sync targets unless they are mission-critical from day one.</span>
              </div>
            </div>
          </section>

          <section className="panel panel-stack">
            <div className="metric-label">Recent booking events</div>
            <div className="workspace-list">
              {recentBookedEvents.length === 0 ? (
                <div className="workspace-list-item">
                  <span className="tiny-muted">No booking events yet for this client.</span>
                </div>
              ) : (
                recentBookedEvents.map((event, index) => (
                  <div key={`${event.createdAt.toISOString()}-${index}`} className="workspace-list-item">
                    <div className="workspace-list-header">
                      <strong>{event.eventType.replace(/_/g, ' ')}</strong>
                      <span className="tiny-muted">{formatCompactDateTime(event.createdAt)}</span>
                    </div>
                    <span className="tiny-muted">{bookingEventDetail(event.payload)}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel panel-stack">
            <div className="metric-label">Saved setup history</div>
            <div className="workspace-list">
              {recentSetupEvents.length === 0 ? (
                <div className="workspace-list-item">
                  <span className="tiny-muted">No booking setup saves yet.</span>
                </div>
              ) : (
                recentSetupEvents.map((event, index) => {
                  const eventState = parseClientCalendarSetupPayload(event.payload);
                  const eventProgress = clientCalendarSetupProgress(eventState);

                  return (
                    <div key={`${event.createdAt.toISOString()}-${index}`} className="workspace-list-item">
                      <div className="workspace-list-header">
                        <strong>{formatCompactDateTime(event.createdAt)}</strong>
                        <span className="tiny-muted">
                          {eventProgress.completed}/{eventProgress.total}
                        </span>
                      </div>
                      <span className="tiny-muted">
                        {connectionLabel(eventState.connectionMode)} • {eventState.googleAccountEmail || eventState.externalPlatformName || 'No target saved'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </LayoutShell>
  );
}
