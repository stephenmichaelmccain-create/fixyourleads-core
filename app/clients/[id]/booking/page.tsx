import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { sendReviewAutomationTestAction } from '@/app/clients/[id]/booking/actions';
import { saveClientCalendarSetupAction } from '@/app/clients/[id]/calendar/actions';
import { db } from '@/lib/db';
import {
  calendarChecklistOrder,
  clientCalendarSetupProgress,
  emptyClientCalendarSetupState,
  parseClientCalendarSetupPayload
} from '@/lib/client-calendar-setup';
import { reviewWebhookUrl } from '@/services/reviews';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
  detail?: string;
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

function reviewEventLabel(eventType: string) {
  switch (eventType) {
    case 'review_request_queued':
      return 'Review queued';
    case 'review_request_sent':
      return 'Review request sent';
    case 'review_score_received':
      return 'Score received';
    case 'review_positive_follow_up_sent':
      return 'Review link sent';
    case 'review_negative_follow_up_sent':
      return 'Private recovery sent';
    case 'review_owner_alert_processed':
      return 'Owner alert processed';
    case 'review_score_clarification_sent':
      return 'Clarification sent';
    default:
      return eventType.replace(/_/g, ' ');
  }
}

function reviewEventDetail(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Review automation event logged.';
  }

  const record = payload as Record<string, unknown>;
  const score = typeof record.score === 'number' ? record.score : null;
  const detail = typeof record.alertDetail === 'string' ? record.alertDetail : typeof record.detail === 'string' ? record.detail : '';
  const destination = typeof record.destination === 'string' ? record.destination : '';
  const scheduledFor = typeof record.nextRunAt === 'string' ? record.nextRunAt : '';

  if (score !== null) {
    return `Score ${score}/10${detail ? ` • ${detail}` : ''}`;
  }

  if (destination) {
    return `${destination}${detail ? ` • ${detail}` : ''}`;
  }

  return detail || scheduledFor || 'Review automation event logged.';
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
          createdAt: true,
          notificationEmail: true,
          primaryContactEmail: true,
          primaryContactPhone: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [
    latestSetupEvent,
    recentSetupEvents,
    upcomingAppointments,
    recentBookedEvents,
    recentReviewEvents,
    reviewRequestsThisMonth,
    reviewScoresThisMonth
  ] = await Promise.all([
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
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            companyId: id,
            eventType: {
              in: [
                'review_request_queued',
                'review_request_sent',
                'review_score_received',
                'review_positive_follow_up_sent',
                'review_negative_follow_up_sent',
                'review_owner_alert_processed',
                'review_score_clarification_sent'
              ]
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
    ),
    safeLoad(
      () =>
        db.eventLog.count({
          where: {
            companyId: id,
            eventType: 'review_request_sent',
            createdAt: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            }
          }
        }),
      0
    ),
    safeLoad(
      () =>
        db.eventLog.count({
          where: {
            companyId: id,
            eventType: 'review_score_received',
            createdAt: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            }
          }
        }),
      0
    )
  ]);

  const state = latestSetupEvent ? parseClientCalendarSetupPayload(latestSetupEvent.payload) : emptyClientCalendarSetupState;
  const progress = clientCalendarSetupProgress(state);
  const ownerAlertFallback =
    state.reviewOwnerAlertContact ||
    company.notificationEmail ||
    company.primaryContactEmail ||
    company.primaryContactPhone ||
    'No alert contact saved yet';
  const reviewEndpoint = reviewWebhookUrl(company.id);

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

      {query.notice === 'review-test-queued' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Review automation test queued.</strong>
          </div>
          <div className="text-muted">The test request is scheduled and should show up in recent review activity as soon as the queue runs it.</div>
        </section>
      )}

      {query.notice === 'review-test-failed' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot warn" />
            <strong>Review automation test failed.</strong>
          </div>
          <div className="text-muted">{query.detail || 'Check the review settings and try again.'}</div>
        </section>
      )}

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Booking workspace</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              Use this page to decide where bookings should land, store the connection details, and monitor what has
              already been booked for this client.
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
          <div className="client-record-stat">
            <span className="metric-label">Review automation</span>
            <strong className="workspace-stats-value">{state.reviewAutomationEnabled ? 'Enabled' : 'Off'}</strong>
            <span className="tiny-muted">{state.reviewGoogleReviewUrl || 'Add the review link, secret, and alert destination.'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Review responses this month</span>
            <strong className="workspace-stats-value">{reviewScoresThisMonth}</strong>
            <span className="tiny-muted">{reviewRequestsThisMonth} requests sent this month.</span>
          </div>
        </div>
      </section>

      <div className="client-record-layout">
        <div className="panel-stack">
          <section className="panel panel-stack">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Booking setup</div>
                <h3 className="section-title">Store the rollout plan</h3>
                <div className="record-subtitle">
                  Keep the destination, sync mode, and visibility settings in one place so operators know exactly where
                  confirmed appointments should go.
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
                <div className="metric-label">Review automation</div>
                <div className="panel-stack">
                  <label className="telnyx-checklist-item">
                    <input type="checkbox" name="reviewAutomationEnabled" defaultChecked={state.reviewAutomationEnabled} />
                    <span>Automatically text for a 1-10 review score after completed appointments</span>
                  </label>
                  <div className="workspace-filter-row">
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="booking-review-delay">
                        Delay after completion (hours)
                      </label>
                      <input
                        id="booking-review-delay"
                        className="text-input"
                        name="reviewDelayHours"
                        defaultValue={state.reviewDelayHours || '2'}
                        placeholder="2"
                      />
                    </div>
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="booking-review-owner-alert">
                        Owner alert destination
                      </label>
                      <input
                        id="booking-review-owner-alert"
                        className="text-input"
                        name="reviewOwnerAlertContact"
                        defaultValue={state.reviewOwnerAlertContact || ''}
                        placeholder={String(ownerAlertFallback)}
                      />
                    </div>
                  </div>
                  <div className="workspace-filter-row">
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="booking-review-url">
                        Google review URL
                      </label>
                      <input
                        id="booking-review-url"
                        className="text-input"
                        name="reviewGoogleReviewUrl"
                        defaultValue={state.reviewGoogleReviewUrl || ''}
                        placeholder="https://g.page/r/.../review"
                      />
                    </div>
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="booking-review-secret">
                        Booking webhook secret
                      </label>
                      <input
                        id="booking-review-secret"
                        className="text-input"
                        name="reviewWebhookSecret"
                        defaultValue={state.reviewWebhookSecret || ''}
                        placeholder="Paste the secret your booking system or Make will send"
                      />
                    </div>
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-review-webhook">
                      Completed appointment webhook URL
                    </label>
                    <input id="booking-review-webhook" className="text-input" value={reviewEndpoint} readOnly />
                    <span className="tiny-muted">
                      Post completed appointments here with the <code>x-review-webhook-secret</code> header. Quiet hours follow the saved timezone.
                    </span>
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

            <div className="client-profile-section">
              <div className="metric-label">Run a test now</div>
              <div className="record-subtitle">
                Queue a sample completed appointment so you can prove the review request flow without waiting on a live booking integration.
              </div>
              <form action={sendReviewAutomationTestAction} className="panel-stack">
                <input type="hidden" name="companyId" value={company.id} />
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-review-test-name">
                      Customer name
                    </label>
                    <input
                      id="booking-review-test-name"
                      className="text-input"
                      name="contactName"
                      placeholder="Test Customer"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="booking-review-test-phone">
                      Destination phone
                    </label>
                    <input
                      id="booking-review-test-phone"
                      className="text-input"
                      name="contactPhone"
                      placeholder="+13035551234"
                    />
                  </div>
                </div>
                <div className="inline-actions">
                  <button type="submit" className="button-secondary">
                    Send test review request
                  </button>
                </div>
              </form>
            </div>
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
            <div className="metric-label">Recent review activity</div>
            <div className="workspace-list">
              {recentReviewEvents.length === 0 ? (
                <div className="workspace-list-item">
                  <span className="tiny-muted">No review automation events yet for this client.</span>
                </div>
              ) : (
                recentReviewEvents.map((event, index) => (
                  <div key={`${event.createdAt.toISOString()}-${index}`} className="workspace-list-item">
                    <div className="workspace-list-header">
                      <strong>{reviewEventLabel(event.eventType)}</strong>
                      <span className="tiny-muted">{formatCompactDateTime(event.createdAt)}</span>
                    </div>
                    <span className="tiny-muted">{reviewEventDetail(event.payload)}</span>
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
