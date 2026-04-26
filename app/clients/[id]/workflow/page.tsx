import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { CopyableCodeBlock } from '@/app/clients/[id]/workflow/CopyableCodeBlock';
import { CopyableUrlField } from '@/app/clients/[id]/workflow/CopyableUrlField';
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

function buildVoiceWebhookExamplePayload(input: {
  companyId: string;
  businessName: string;
  calledNumber: string | null;
}) {
  return JSON.stringify(
    {
      companyId: input.companyId,
      calledNumber: input.calledNumber || '+13035550199',
      phone: '+13125550123',
      fullName: 'Jordan Avery',
      email: 'jordan@example.com',
      purpose: 'Consultation',
      startTime: '2026-04-28T15:00:00.000Z',
      meetingUrl: 'https://meet.google.com/example-link',
      displayCompanyName: input.businessName,
      notes: 'Booked by AI voice agent after qualifying the caller.',
      callId: 'telnyx-call-control-id',
      recordingUrl: 'https://storage.telnyx.com/recording.mp3',
      transcriptUrl: 'https://storage.telnyx.com/transcript.json',
      transcriptText: 'Caller asked for a consultation and accepted Tuesday at 10 AM.'
    },
    null,
    2
  );
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
          telnyxAssistantId: true,
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
  const voiceWebhookSecret =
    process.env.VOICE_BOOKING_WEBHOOK_SECRET?.trim() ||
    process.env.VOICE_DEMO_WEBHOOK_SECRET?.trim() ||
    process.env.INTERNAL_API_KEY?.trim() ||
    '';
  const defaultVoiceWebhookUrl = appBaseUrl ? `${appBaseUrl}/api/webhooks/voice/appointments` : '';
  const workflowPageUrl = appBaseUrl ? `${appBaseUrl}/clients/${company.id}/workflow` : '';
  const voiceWebhookTarget = voiceState.webhookUrl || defaultVoiceWebhookUrl;
  const workflowTarget = voiceState.automationUrl || workflowPageUrl;
  const voiceWebhookExamplePayload = buildVoiceWebhookExamplePayload({
    companyId: company.id,
    businessName: company.name,
    calledNumber: voiceState.phoneNumber
  });
  const telnyxToolName = 'fyl_book_call';
  const telnyxToolDescription = `Book a ${company.name} discovery call after availability is confirmed. Only use this after confirming the slot with the caller.`;
  const telnyxHeaderName = 'X-Voice-Webhook-Secret';

  const crmConnected = Boolean(company.crmCredentialsEncrypted);
  const bookingConnected = Boolean(
    bookingState.externalPlatformName || bookingState.externalCalendarId || latestBookingSetupEvent
  );
  const latestWorkflowEdit = [latestVoiceSetupEvent?.createdAt, latestBookingSetupEvent?.createdAt, company.createdAt]
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
              <input type="hidden" name="webhookUrl" value={voiceWebhookTarget} />
              <input type="hidden" name="automationUrl" value={workflowTarget} />
            </div>
            <div className="panel panel-dark panel-stack" style={{ marginTop: 16 }}>
              <div className="metric-label">Telnyx setup</div>
              <div className="record-header">
                <div className="panel-stack">
                  <h3 className="section-title">Copy this into the Telnyx webhook tool</h3>
                  <div className="record-subtitle">
                    This is the only Telnyx setup block you should need for this client.
                  </div>
                </div>
              </div>
              <div className="telnyx-setup-shell">
                <div className="telnyx-setup-grid">
                  <div className="telnyx-setup-card">
                    <div className="metric-label">Tool details</div>
                    <div className="telnyx-setup-fields">
                      <CopyableUrlField
                        id="telnyx-tool-name"
                        label="Tool name"
                        defaultValue={telnyxToolName}
                        fallbackCopyValue={telnyxToolName}
                        copyButtonLabel="Copy"
                        readOnly
                      />
                      <CopyableUrlField
                        id="telnyx-tool-description"
                        label="Description"
                        defaultValue={telnyxToolDescription}
                        fallbackCopyValue={telnyxToolDescription}
                        copyButtonLabel="Copy"
                        readOnly
                      />
                      <div className="workspace-filter-row telnyx-inline-grid">
                        <CopyableUrlField
                          id="telnyx-request-mode"
                          label="Request mode"
                          defaultValue="Sync"
                          fallbackCopyValue="Sync"
                          copyButtonLabel="Copy"
                          readOnly
                        />
                        <CopyableUrlField
                          id="telnyx-method"
                          label="Method"
                          defaultValue="POST"
                          fallbackCopyValue="POST"
                          copyButtonLabel="Copy"
                          readOnly
                        />
                      </div>
                      <CopyableUrlField
                        id="telnyx-webhook-url"
                        label="Webhook URL"
                        defaultValue={voiceWebhookTarget}
                        fallbackCopyValue={voiceWebhookTarget || defaultVoiceWebhookUrl}
                        copyButtonLabel="Copy URL"
                        readOnly
                      />
                    </div>
                  </div>
                  <div className="telnyx-setup-card">
                    <div className="metric-label">Header + routing</div>
                    <div className="telnyx-setup-fields">
                      <div className="workspace-filter-row telnyx-inline-grid">
                        <CopyableUrlField
                          id="telnyx-header-name"
                          label="Header name"
                          defaultValue={telnyxHeaderName}
                          fallbackCopyValue={telnyxHeaderName}
                          copyButtonLabel="Copy"
                          readOnly
                        />
                        <CopyableUrlField
                          id="telnyx-header-value"
                          label="Header value"
                          defaultValue={voiceWebhookSecret}
                          placeholder="Set VOICE_BOOKING_WEBHOOK_SECRET or INTERNAL_API_KEY in Railway"
                          fallbackCopyValue={voiceWebhookSecret}
                          copyButtonLabel="Copy secret"
                          readOnly
                        />
                      </div>
                      <div className="workspace-filter-row telnyx-inline-grid">
                        <CopyableUrlField
                          id="telnyx-company-id"
                          label="companyId"
                          defaultValue={company.id}
                          fallbackCopyValue={company.id}
                          copyButtonLabel="Copy"
                          readOnly
                        />
                        <CopyableUrlField
                          id="telnyx-called-number"
                          label="calledNumber"
                          defaultValue={voiceState.phoneNumber || ''}
                          placeholder="Save the client voice line above"
                          fallbackCopyValue={voiceState.phoneNumber || ''}
                          copyButtonLabel="Copy"
                          readOnly
                        />
                      </div>
                      <CopyableUrlField
                        id="telnyx-assistant-id"
                        label="telnyxAssistantId"
                        defaultValue={company.telnyxAssistantId || ''}
                        placeholder="Optional if you prefer routing by assistant ID"
                        fallbackCopyValue={company.telnyxAssistantId || ''}
                        copyButtonLabel="Copy"
                        readOnly
                      />
                    </div>
                  </div>
                </div>
                <div className="telnyx-setup-meta">
                  <div className="key-value-card">
                    <span className="key-value-label">Route this client by</span>
                    companyId, calledNumber, or telnyxAssistantId
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Must send</span>
                    phone, startTime
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Internal workflow link</span>
                    {workflowTarget || 'Not set'}
                  </div>
                </div>
                <div className="telnyx-setup-card telnyx-setup-card-wide">
                  <div className="metric-label">Body parameters</div>
                  <div className="key-value-grid">
                    <div className="key-value-card">
                      <span className="key-value-label">Required</span>
                      phone, startTime
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">Client routing</span>
                      companyId and calledNumber
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">Helpful extras</span>
                      fullName, email, purpose, notes
                    </div>
                  </div>
                  <CopyableCodeBlock label="Starter JSON body" value={voiceWebhookExamplePayload} copyButtonLabel="Copy JSON" />
                </div>
              </div>
              <div className="text-muted">
                Point the client&apos;s AI voice agent at this webhook when a real appointment is booked. Authorize with either
                `Authorization: Bearer $VOICE_BOOKING_WEBHOOK_SECRET` or `X-Voice-Webhook-Secret: $VOICE_BOOKING_WEBHOOK_SECRET`.
                If signature verification is enabled, keep sending the normal Telnyx signature headers too.
              </div>
              {!voiceWebhookSecret && (
                <div className="text-muted">
                  No shared webhook secret is configured in this app yet. Add `VOICE_BOOKING_WEBHOOK_SECRET` in Railway, or the
                  app will fall back to `INTERNAL_API_KEY` once that is present.
                </div>
              )}
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
            <span className="tiny-muted">Last edited {formatCompactDateTime(latestWorkflowEdit)}</span>
          </div>
        </form>
      </section>
    </LayoutShell>
  );
}
