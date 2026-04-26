import { CrmProvider } from '@prisma/client';
import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { saveClientWorkflowAction } from '@/app/clients/[id]/workflow/actions';
import { LayoutShell } from '@/app/components/LayoutShell';
import { emptyClientCalendarSetupState, parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { db } from '@/lib/db';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
  test?: string;
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

function providerLabel(provider: CrmProvider) {
  const labels: Record<CrmProvider, string> = {
    NONE: 'Not connected',
    HUBSPOT: 'HubSpot',
    PIPEDRIVE: 'Pipedrive',
    GOHIGHLEVEL: 'GoHighLevel',
    SALESFORCE: 'Salesforce',
    BOULEVARD: 'Boulevard',
    VAGARO: 'Vagaro'
  };

  return labels[provider];
}

export default async function ClientWorkflowPage({
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
          crmProvider: true,
          crmCredentialsEncrypted: true,
          createdAt: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [latestVoiceSetupEvent, latestBookingSetupEvent] = await Promise.all([
    safeLoad(
      () =>
        db.eventLog.findFirst({
          where: { companyId: id, eventType: 'client_telnyx_setup_updated' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true, createdAt: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.eventLog.findFirst({
          where: { companyId: id, eventType: 'client_calendar_setup_updated' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true, createdAt: true }
        }),
      null
    )
  ]);

  const voiceState = latestVoiceSetupEvent
    ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload)
    : emptyTelnyxSetupState;
  const bookingState = latestBookingSetupEvent
    ? parseClientCalendarSetupPayload(latestBookingSetupEvent.payload)
    : emptyClientCalendarSetupState;

  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || null;
  const defaultWebhookUrl = appBaseUrl ? `${appBaseUrl}/api/webhooks/telnyx` : '';
  const voiceWebhookTarget = voiceState.webhookUrl || '';
  const voiceWebhookDisplay = voiceState.webhookUrl || defaultWebhookUrl || 'Not saved yet';

  const crmConnected = Boolean(company.crmCredentialsEncrypted);
  const voiceConnected = Boolean(voiceState.webhookUrl);
  const bookingConnected = Boolean(
    bookingState.externalPlatformName || bookingState.externalCalendarId || latestBookingSetupEvent
  );
  const latestSave = [latestVoiceSetupEvent?.createdAt, latestBookingSetupEvent?.createdAt, company.createdAt]
    .filter(Boolean)
    .sort((a, b) => new Date(b as Date).getTime() - new Date(a as Date).getTime())[0];

  const notice = query.notice || '';
  const showSavedNotice = ['updated', 'crm_updated'].includes(notice);

  return (
    <LayoutShell
      title={`${company.name} · Workflow`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="workflow" />

      {showSavedNotice && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Workflow setup saved.</strong>
          </div>
          <div className="text-muted">The latest API keys and webhook settings are now attached to this client workspace.</div>
        </section>
      )}

      {notice === 'encryption_key_missing' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot error" />
            <strong>Secure key storage is not ready yet.</strong>
          </div>
          <div className="text-muted">Set `CRM_CREDENTIAL_ENCRYPTION_KEY` before saving CRM or calendar API keys.</div>
        </section>
      )}

      {notice === 'credentials_invalid' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot error" />
            <strong>We could not save those API keys.</strong>
          </div>
          <div className="text-muted">Try again with fresh keys, or leave the key fields blank to keep the ones already saved.</div>
        </section>
      )}

      {query.test && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${query.test === 'success' ? 'ok' : 'error'}`} />
            <strong>CRM test {query.test === 'success' ? 'worked' : 'failed'}.</strong>
          </div>
          <div className="text-muted">{query.detail || 'No detail returned'}</div>
        </section>
      )}

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Workflow setup</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              One simple place for CRM keys, AI voice webhook details, and calendar access. Save it here and the workflow
              uses the newest values.
            </div>
          </div>
          <div className="workspace-action-rail">
            <a className="button-secondary" href={`/clients/${company.id}`}>
              Back to profile
            </a>
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              Activity
            </a>
          </div>
        </div>

        <div className="client-record-stats">
          <div className="client-record-stat">
            <span className="metric-label">CRM</span>
            <strong className="workspace-stats-value">{providerLabel(company.crmProvider)}</strong>
            <span className="tiny-muted">{crmConnected ? 'API keys saved securely' : 'No CRM keys saved yet'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">AI voice</span>
            <strong className="workspace-stats-value">{voiceConnected ? 'Webhook ready' : 'Needs webhook'}</strong>
            <span className="tiny-muted">{voiceWebhookDisplay}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Calendar</span>
            <strong className="workspace-stats-value">{bookingState.externalPlatformName || 'Not connected'}</strong>
            <span className="tiny-muted">
              {bookingConnected ? 'Platform details are attached to this workspace.' : 'No calendar platform saved yet'}
            </span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Last save</span>
            <strong className="workspace-stats-value">{formatCompactDateTime(latestSave)}</strong>
            <span className="tiny-muted">Use one save and keep the workflow current.</span>
          </div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Workflow form</div>
            <h3 className="section-title">Save the keys and webhook targets</h3>
            <div className="record-subtitle">
              This replaces the old CRM, AI Voice, and Calendar tabs. Leave any key field blank if you want to keep the saved
              secret exactly as it is.
            </div>
          </div>
        </div>

        <form action={saveClientWorkflowAction} className="panel-stack client-profile-form">
          <input type="hidden" name="companyId" value={company.id} />

          <div className="client-profile-section">
            <div className="metric-label">CRM</div>
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-crm-provider">
                  CRM provider
                </label>
                <select id="workflow-crm-provider" className="select-input" name="crmProvider" defaultValue={company.crmProvider}>
                  <option value="NONE">Not connected</option>
                  <option value="HUBSPOT">HubSpot</option>
                  <option value="PIPEDRIVE">Pipedrive</option>
                  <option value="GOHIGHLEVEL">GoHighLevel</option>
                  <option value="SALESFORCE">Salesforce</option>
                  <option value="BOULEVARD">Boulevard</option>
                  <option value="VAGARO">Vagaro</option>
                </select>
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-crm-api-key">
                  CRM API key
                </label>
                <input
                  id="workflow-crm-api-key"
                  className="text-input"
                  name="crmApiKey"
                  type="password"
                  autoComplete="new-password"
                  placeholder={crmConnected ? 'Saved securely' : 'Paste API key'}
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-crm-secondary-key">
                  Location, account, or secondary key
                </label>
                <input
                  id="workflow-crm-secondary-key"
                  className="text-input"
                  name="crmSecondaryKey"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          <div className="client-profile-section">
            <div className="metric-label">AI voice</div>
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-voice-line">
                  Voice line
                </label>
                <input
                  id="workflow-voice-line"
                  className="text-input"
                  name="voiceLine"
                  defaultValue={voiceState.phoneNumber || ''}
                  placeholder="+13035550199"
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-webhook-url">
                  Webhook URL
                </label>
                <input
                  id="workflow-webhook-url"
                  className="text-input"
                  name="webhookUrl"
                  defaultValue={voiceWebhookTarget}
                  placeholder={defaultWebhookUrl || 'https://your-provider.com/webhook'}
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-automation-url">
                  Workflow URL
                </label>
                <input
                  id="workflow-automation-url"
                  className="text-input"
                  name="automationUrl"
                  defaultValue={voiceState.automationUrl || ''}
                  placeholder="https://make.com/... or internal workflow link"
                />
              </div>
            </div>
          </div>

          <div className="client-profile-section">
            <div className="metric-label">Calendar</div>
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-booking-platform">
                  Platform name
                </label>
                <input
                  id="workflow-booking-platform"
                  className="text-input"
                  name="bookingPlatformName"
                  defaultValue={bookingState.externalPlatformName || ''}
                  placeholder="Calendly, Boulevard, Vagaro, GoHighLevel"
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-booking-platform-id">
                  Calendar, account, or location ID
                </label>
                <input
                  id="workflow-booking-platform-id"
                  className="text-input"
                  name="bookingPlatformId"
                  defaultValue={bookingState.externalCalendarId || ''}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-booking-api-key">
                  Calendar API key
                </label>
                <input
                  id="workflow-booking-api-key"
                  className="text-input"
                  name="bookingApiKey"
                  type="password"
                  autoComplete="new-password"
                  placeholder={bookingConnected ? 'Saved securely' : 'Paste API key'}
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="workflow-booking-secondary-key">
                  Secondary key or secret
                </label>
                <input
                  id="workflow-booking-secondary-key"
                  className="text-input"
                  name="bookingSecondaryKey"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          <div className="inline-row">
            <button className="button button-primary" type="submit">
              Save workflow setup
            </button>
            <span className="tiny-muted">You only need this one screen now.</span>
          </div>
        </form>
      </section>
    </LayoutShell>
  );
}
