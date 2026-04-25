import { notFound } from 'next/navigation';
import { saveClientCalendarSetupAction } from '@/app/clients/[id]/calendar/actions';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { emptyClientCalendarSetupState, parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { db } from '@/lib/db';
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

function readPayloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
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
          name: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const latestSetupEvent = await safeLoad(
    () =>
      db.eventLog.findFirst({
        where: {
          companyId: id,
          eventType: 'client_calendar_setup_updated'
        },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          payload: true
        }
      }),
    null
  );

  const state = latestSetupEvent
    ? parseClientCalendarSetupPayload(latestSetupEvent.payload)
    : emptyClientCalendarSetupState;
  const payload = readPayloadRecord(latestSetupEvent?.payload);
  const bookingCredentialsSaved = Boolean(payloadString(payload, 'externalPlatformCredentialsEncrypted'));

  return (
    <LayoutShell
      title={`${company.name} · Calendar`}
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
            <strong>Calendar connection saved.</strong>
          </div>
          <div className="text-muted">Any API keys you saved stay hidden after submission.</div>
        </section>
      )}

      {query.notice === 'encryption_key_missing' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot error" />
            <strong>Secure key storage is not ready yet.</strong>
          </div>
          <div className="text-muted">Set `CRM_CREDENTIAL_ENCRYPTION_KEY` before saving calendar API keys.</div>
        </section>
      )}

      {query.notice === 'credentials_invalid' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot error" />
            <strong>We could not save those API keys.</strong>
          </div>
          <div className="text-muted">Try again with fresh keys, or leave the key fields blank to keep the saved ones.</div>
        </section>
      )}

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Calendar</div>
            <h1 className="section-title">Connect the booking application</h1>
            <div className="record-subtitle">
              Keep this page focused on the calendar app this client uses and the API credentials needed to connect it.
            </div>
          </div>
          <div className="client-status-hero is-pending">
            <span className={`status-dot ${bookingCredentialsSaved ? 'ok' : 'warn'}`} />
            <strong>{bookingCredentialsSaved ? 'Keys saved securely' : 'Keys still needed'}</strong>
            <span className="tiny-muted">Last save {formatCompactDateTime(state.updatedAt || latestSetupEvent?.createdAt)}</span>
          </div>
        </div>

        <form action={saveClientCalendarSetupAction} className="panel-stack client-profile-form">
          <input type="hidden" name="companyId" value={company.id} />
          <input type="hidden" name="connectionMode" value="external_booking" />

          <div className="client-profile-section">
            <div className="metric-label">Application</div>
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="external-platform-name">
                  Calendar or booking app
                </label>
                <input
                  id="external-platform-name"
                  className="text-input"
                  name="externalPlatformName"
                  defaultValue={state.externalPlatformName || ''}
                  placeholder="Calendly, Boulevard, Vagaro, GoHighLevel"
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="external-calendar-id">
                  Account, calendar, or location ID
                </label>
                <input
                  id="external-calendar-id"
                  className="text-input"
                  name="externalCalendarId"
                  defaultValue={state.externalCalendarId || ''}
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          <div className="client-profile-section">
            <div className="metric-label">API access</div>
            <div className="record-subtitle">
              Leave the key fields blank if you want to keep the credentials already saved.
            </div>
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="external-platform-api-key">
                  API key
                </label>
                <input
                  id="external-platform-api-key"
                  className="text-input"
                  name="externalPlatformApiKey"
                  type="password"
                  autoComplete="new-password"
                  placeholder={bookingCredentialsSaved ? 'Saved securely' : 'Paste API key'}
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="external-platform-secondary-key">
                  Secondary key or secret
                </label>
                <input
                  id="external-platform-secondary-key"
                  className="text-input"
                  name="externalPlatformSecondaryKey"
                  type="password"
                  autoComplete="new-password"
                  placeholder={bookingCredentialsSaved ? 'Saved securely' : 'Paste secondary key'}
                />
              </div>
            </div>
          </div>

          <div className="inline-row">
            <button className="button button-primary" type="submit">
              Save calendar setup
            </button>
            <span className="tiny-muted">
              {bookingCredentialsSaved
                ? 'Credentials are already stored securely for this client.'
                : 'No secure API keys saved yet.'}
            </span>
          </div>
        </form>
      </section>
    </LayoutShell>
  );
}
