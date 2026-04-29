import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { CopyableUrlField } from '@/app/clients/[id]/workflow/CopyableUrlField';
import {
  connectClientTelnyxAssistantAction,
  resetClientAutomationAction,
  retryClientAutomationAction,
  saveClientWorkflowAction
} from '@/app/clients/[id]/workflow/actions';
import { LayoutShell } from '@/app/components/LayoutShell';
import { emptyClientAutomationState, parseClientAutomationPayload } from '@/lib/client-automation';
import { emptyClientCalendarSetupState, parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { db } from '@/lib/db';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
}>;

function automationStatusPresentation(status: string) {
  if (status === 'READY') {
    return {
      dot: 'ok',
      label: 'Ready',
      toneClass: 'status-chip status-chip-confirmed'
    };
  }

  if (status === 'ACTION_REQUIRED') {
    return {
      dot: 'warn',
      label: 'Action required',
      toneClass: 'status-chip status-chip-attention'
    };
  }

  if (status === 'FAILED') {
    return {
      dot: 'error',
      label: 'Failed',
      toneClass: 'status-chip status-chip-attention'
    };
  }

  if (status === 'PENDING') {
    return {
      dot: 'warn',
      label: 'Provisioning',
      toneClass: 'status-chip status-chip-muted'
    };
  }

  return {
    dot: 'warn',
    label: 'Not configured',
    toneClass: 'status-chip status-chip-muted'
  };
}

function stepTone(isReady: boolean) {
  return isReady ? 'status-chip status-chip-confirmed' : 'status-chip status-chip-muted';
}

function payloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function payloadString(payload: unknown, key: string) {
  const value = payloadRecord(payload)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function connectionStage(input: {
  platformConfigured: boolean;
  workflowReady: boolean;
  testPassed: boolean;
}) {
  if (input.testPassed) {
    return {
      label: 'Live and tested',
      title: 'Live and tested.',
      detail: 'The booking system, n8n workflow, and voice path have a confirmed test.',
      toneClass: 'status-chip status-chip-confirmed',
      dot: 'ok'
    };
  }

  if (input.workflowReady) {
    return {
      label: 'Test booking needed',
      title: 'Workflow ready for live booking.',
      detail: 'Connect the Telnyx assistant to the workflow-specific MCP URL, then run one real booking test.',
      toneClass: 'status-chip status-chip-muted',
      dot: 'warn'
    };
  }

  if (input.platformConfigured) {
    return {
      label: 'Ready to launch',
      title: 'Booking system saved.',
      detail: 'Launch the n8n workflow next, then connect the Telnyx assistant to the workflow-specific MCP URL.',
      toneClass: 'status-chip status-chip-muted',
      dot: 'warn'
    };
  }

  return {
    label: 'Needs setup',
    title: 'Choose the booking system.',
    detail: 'Pick where appointments actually live, then launch the n8n MCP connection.',
    toneClass: 'status-chip status-chip-muted',
    dot: 'warn'
  };
}

export default async function ClientConnectionsPage({
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
          telnyxInboundNumber: true,
          telnyxAssistantId: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [latestVoiceSetupEvent, latestAutomationEvent, latestCalendarSetupEvent] = await Promise.all([
    safeLoad(
      () =>
        db.eventLog.findFirst({
          where: { companyId: id, eventType: 'client_telnyx_setup_updated' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.eventLog.findFirst({
          where: { companyId: id, eventType: 'client_automation_updated' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.eventLog.findFirst({
          where: { companyId: id, eventType: 'client_calendar_setup_updated' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true }
        }),
      null
    )
  ]);

  const voiceState = latestVoiceSetupEvent
    ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload)
    : emptyTelnyxSetupState;
  const automationState = latestAutomationEvent
    ? parseClientAutomationPayload(latestAutomationEvent.payload)
    : emptyClientAutomationState;
  const calendarState = latestCalendarSetupEvent
    ? parseClientCalendarSetupPayload(latestCalendarSetupEvent.payload)
    : emptyClientCalendarSetupState;
  const automationPresentation = automationStatusPresentation(automationState.status);
  const latestCalendarPayload = latestCalendarSetupEvent?.payload;
  const bookingCredentialsSaved = Boolean(payloadString(latestCalendarPayload, 'externalPlatformCredentialsEncrypted'));
  const secondaryPlatformName = payloadString(latestCalendarPayload, 'secondaryPlatformName');
  const secondaryPlatformUrl = payloadString(latestCalendarPayload, 'secondaryPlatformUrl');
  const secondaryPlatformId = payloadString(latestCalendarPayload, 'secondaryPlatformId');

  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || null;
  const directVoiceWebhookTarget = voiceState.webhookUrl || (appBaseUrl ? `${appBaseUrl}/api/webhooks/voice/appointments` : '');
  const mcpServerName = `${company.name} voice mcp`;
  const availabilityToolName = 'check_availability';
  const bookingToolName = 'book_appointment';
  const cancelToolName = 'cancel_appointment';
  const bookingPlatformLabel =
    calendarState.externalPlatformName ||
    (calendarState.connectionMode === 'google_calendar'
      ? 'Google Calendar'
      : calendarState.connectionMode === 'external_booking'
        ? 'External booking platform'
        : null);
  const platformConfigured = Boolean(bookingPlatformLabel || calendarState.externalPlatformUrl || bookingCredentialsSaved);
  const workflowReady = Boolean(automationState.workflowActive && automationState.workflowEditorUrl);
  const mcpServerUrl = automationState.workflowMcpUrl;
  const activeWorkflowUrl = mcpServerUrl || automationState.workflowWebhookUrl;
  const activeWorkflowLabel =
    automationState.triggerType === 'mcp'
      ? 'MCP server URL'
      : automationState.triggerType === 'webhook'
        ? 'Webhook URL'
        : 'Workflow URL';
  const activeAssistantId = company.telnyxAssistantId || voiceState.assistantId;
  const telnyxReady = Boolean(workflowReady && mcpServerUrl && activeAssistantId);
  const testReady = Boolean(calendarState.syncTestPassed && calendarState.launchApproved);
  const workflowNeedsAttention = automationState.status === 'ACTION_REQUIRED' || automationState.status === 'FAILED';
  const stage = connectionStage({
    platformConfigured,
    workflowReady,
    testPassed: testReady
  });
  const calledNumber = voiceState.phoneNumber || company.telnyxInboundNumber || '';

  return (
    <LayoutShell
      title={`${company.name} · Connections`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="connections" />

      {query.notice ? (
        <section className="panel panel-stack" style={{ marginBottom: 20 }}>
          <div className="metric-label">Connections update</div>
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            {query.notice === 'updated'
              ? 'Connection setup saved.'
              : query.notice === 'automation_ready'
                ? 'MCP workflow ready.'
                : query.notice === 'automation_reset'
                  ? 'Client workflow reset.'
                  : query.notice === 'telnyx_connected'
                    ? 'Telnyx connected.'
                    : query.notice === 'telnyx_attention'
                      ? 'Telnyx needs one more step.'
                      : query.notice === 'telnyx_failed'
                        ? 'Telnyx connection failed.'
                : query.notice === 'automation_attention'
                  ? 'MCP workflow needs one more check.'
                  : 'Connection setup failed.'}
          </h2>
          <div className="text-muted">
            {query.notice === 'updated'
              ? 'The booking system was saved and the n8n workflow was updated.'
              : query.notice === 'automation_ready'
                ? 'The client workflow is active. Connect Telnyx to the n8n MCP server URL, then run one test booking.'
                : query.notice === 'automation_reset'
                  ? 'The saved booking system stayed in place, and the client workflow was removed from n8n.'
                  : query.notice === 'telnyx_connected'
                    ? 'One-click Telnyx setup finished. Assistant and MCP server are now linked to this client.'
                    : query.notice === 'telnyx_attention'
                      ? voiceState.notes || 'Auto-connect paused because one prerequisite is missing.'
                      : query.notice === 'telnyx_failed'
                        ? voiceState.notes || 'Auto-connect failed. Review the message and retry.'
                : query.notice === 'automation_attention'
                  ? automationState.lastError || 'Something still needs a manual check in n8n or Railway.'
                  : automationState.lastError || 'Provisioning failed. Review the error below and retry after fixing the blocker.'}
          </div>
        </section>
      ) : null}

      <section className="panel panel-stack telnyx-page-panel connections-launch-panel">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Connections</div>
            <h3 className="section-title">{stage.title}</h3>
            <div className="record-subtitle">{stage.detail}</div>
          </div>
          <span className={stage.toneClass}>
            <span className={`status-dot ${stage.dot}`} />
            {stage.label}
          </span>
        </div>

        <form action={saveClientWorkflowAction} className="connections-flow">
          <input type="hidden" name="companyId" value={company.id} />
          <input type="hidden" name="crmProvider" value={company.crmProvider} />
          <input type="hidden" name="voiceLine" value={calledNumber} />
          <input type="hidden" name="webhookUrl" value={voiceState.webhookUrl || directVoiceWebhookTarget} />

          <section className="connections-step">
            <div className="connections-step-number">1</div>
            <div className="connections-step-body">
              <div className="connections-step-head">
                <div>
                  <h4 className="section-title">Choose booking system</h4>
                  <div className="tiny-muted">Pick the live calendar or booking platform this assistant should write into.</div>
                </div>
                <span className={stepTone(platformConfigured)}>
                  <span className={`status-dot ${platformConfigured ? 'ok' : 'warn'}`} />
                  {platformConfigured ? 'Saved' : 'Needed'}
                </span>
              </div>
              <div className="tiny-muted">
                This should be the real system of record for availability, booking, cancellation, and confirmation emails.
              </div>
              <div className="workspace-filter-row">
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="connections-booking-platform">
                    Live booking platform
                  </label>
                  <input
                    id="connections-booking-platform"
                    className="text-input"
                    name="bookingPlatformName"
                    defaultValue={bookingPlatformLabel || ''}
                    list="booking-platform-options"
                    placeholder="Jane, GoHighLevel, Calendly, Google Calendar..."
                  />
                  <datalist id="booking-platform-options">
                    <option value="GoHighLevel" />
                    <option value="Google Calendar" />
                    <option value="Calendly" />
                    <option value="Jane App" />
                    <option value="Vagaro" />
                    <option value="Boulevard" />
                    <option value="Acuity" />
                    <option value="Square Appointments" />
                    <option value="HubSpot" />
                    <option value="Salesforce" />
                    <option value="Other / custom" />
                  </datalist>
                </div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="connections-booking-url">
                    Platform URL
                  </label>
                  <input
                    id="connections-booking-url"
                    className="text-input"
                    name="bookingPlatformUrl"
                    defaultValue={calendarState.externalPlatformUrl || ''}
                    placeholder="https://..."
                  />
                </div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="connections-booking-id">
                    Calendar or location ID
                  </label>
                  <input
                    id="connections-booking-id"
                    className="text-input"
                    name="bookingPlatformId"
                    defaultValue={calendarState.externalCalendarId || ''}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="workspace-filter-row">
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="connections-booking-key">
                    API key or access token
                  </label>
                  <input
                    id="connections-booking-key"
                    className="text-input"
                    name="bookingApiKey"
                    type="password"
                    placeholder={bookingCredentialsSaved ? 'Saved. Enter a new key only to replace it.' : 'Paste key if needed'}
                  />
                </div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="connections-booking-secret">
                    Secret or second credential
                  </label>
                  <input
                    id="connections-booking-secret"
                    className="text-input"
                    name="bookingSecondaryKey"
                    type="password"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="tiny-muted">
                Only add credentials here if this client needs them for live booking writeback.
              </div>
              <details className="connections-secondary">
                <summary className="details-summary">Secondary system (optional)</summary>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="connections-secondary-platform">
                      Secondary platform
                    </label>
                    <input
                      id="connections-secondary-platform"
                      className="text-input"
                      name="secondaryPlatformName"
                      defaultValue={secondaryPlatformName}
                      placeholder="Optional CRM or backup calendar"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="connections-secondary-url">
                      Secondary URL
                    </label>
                    <input
                      id="connections-secondary-url"
                      className="text-input"
                      name="secondaryPlatformUrl"
                      defaultValue={secondaryPlatformUrl}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="connections-secondary-id">
                      Secondary ID
                    </label>
                    <input
                      id="connections-secondary-id"
                      className="text-input"
                      name="secondaryPlatformId"
                      defaultValue={secondaryPlatformId}
                      placeholder="Optional"
                    />
                  </div>
                </div>
              </details>
            </div>
          </section>

          <section className="connections-step">
            <div className="connections-step-number">2</div>
            <div className="connections-step-body">
              <div className="connections-step-head">
                <div>
                  <h4 className="section-title">Launch n8n MCP</h4>
                  <div className="tiny-muted">Create or refresh the client workflow that exposes the booking tools to Telnyx.</div>
                </div>
                <span className={stepTone(workflowReady)}>
                  <span className={`status-dot ${workflowReady ? 'ok' : 'warn'}`} />
                  {workflowReady ? 'Ready' : automationPresentation.label}
                </span>
              </div>
              <div className="connections-inline-status">
                <span>{automationState.workflowName || 'No workflow launched yet'}</span>
                {automationState.workflowEditorUrl ? (
                  <a className="button-ghost button-secondary-compact" href={automationState.workflowEditorUrl} target="_blank" rel="noreferrer">
                    Open n8n
                  </a>
                ) : null}
              </div>
              <div className="action-cluster">
                <button type="submit" className="button">
                  Save and launch
                </button>
                {workflowNeedsAttention ? (
                  <button formAction={retryClientAutomationAction} type="submit" className="button-ghost button-secondary-compact">
                    Retry launch
                  </button>
                ) : null}
                {automationState.workflowId ? (
                  <button formAction={resetClientAutomationAction} type="submit" className="button-ghost button-secondary-compact">
                    Reset client
                  </button>
                ) : null}
              </div>
              <div className="tiny-muted">
                This step should leave you with one workflow-specific MCP URL for this client, not the instance-wide n8n MCP server.
              </div>
            </div>
          </section>
        </form>

        <section className="connections-step">
          <div className="connections-step-number">3</div>
          <div className="connections-step-body">
              <div className="connections-step-head">
                <div>
                  <h4 className="section-title">Connect Telnyx</h4>
                  <div className="tiny-muted">Point the Telnyx assistant at the workflow-specific MCP URL for this client.</div>
                </div>
              <span className={stepTone(telnyxReady)}>
                <span className={`status-dot ${telnyxReady ? 'ok' : 'warn'}`} />
                {telnyxReady ? 'Ready' : 'After launch'}
              </span>
            </div>
            <div className="connections-tool-strip">
              <span>{availabilityToolName}</span>
              <span>{bookingToolName}</span>
              <span>{cancelToolName}</span>
            </div>
            <div className="action-cluster">
              <CopyableUrlField
                id="connections-mcp-server-name"
                label="Server name"
                defaultValue={mcpServerName}
                fallbackCopyValue={mcpServerName}
                copyButtonLabel="Copy"
                readOnly
              />
              <CopyableUrlField
                id="connections-mcp-server-url"
                label={activeWorkflowLabel}
                defaultValue={activeWorkflowUrl ?? undefined}
                fallbackCopyValue={activeWorkflowUrl ?? undefined}
                placeholder="Launch the workflow first"
                copyButtonLabel="Copy URL"
                readOnly
              />
            </div>
            <div className="connections-inline-status">
              <span>{activeAssistantId ? `Assistant: ${activeAssistantId}` : 'Assistant not linked yet'}</span>
              {voiceState.mcpServerId ? <span>{`MCP server: ${voiceState.mcpServerId}`}</span> : null}
            </div>
            <div className="action-cluster">
              <form action={connectClientTelnyxAssistantAction}>
                <input type="hidden" name="companyId" value={company.id} />
                <button
                  type="submit"
                  className="button-ghost button-secondary-compact"
                  disabled={!mcpServerUrl}
                  title={mcpServerUrl ? 'Create or link Telnyx assistant + MCP automatically' : 'Launch MCP workflow first'}
                >
                  Connect Telnyx automatically
                </button>
              </form>
            </div>
            <div className="tiny-muted">
              {automationState.triggerType === 'mcp'
                ? 'Use this workflow-specific MCP server URL in the Telnyx assistant.'
                : automationState.triggerType === 'webhook'
                  ? 'This workflow is still exposing a webhook URL. Re-launch it until it returns a workflow-specific MCP server URL.'
                  : 'Launch the workflow first, then copy the workflow-specific MCP server URL from here.'}
            </div>
            <div className="tiny-muted">
              One-click auto-connect needs `TELNYX_API_KEY` and either `TELNYX_TEMPLATE_ASSISTANT_ID` or both
              `TELNYX_ASSISTANT_MODEL` + `TELNYX_ASSISTANT_INSTRUCTIONS`.
            </div>
            {voiceState.notes ? <div className="tiny-muted">{voiceState.notes}</div> : null}
          </div>
        </section>

        <section className="connections-step">
          <div className="connections-step-number">4</div>
          <div className="connections-step-body">
              <div className="connections-step-head">
                <div>
                  <h4 className="section-title">Test booking</h4>
                  <div className="tiny-muted">Run one real call and confirm availability lookup, booking writeback, and a clean cancel or reschedule path.</div>
                </div>
              <span className={stepTone(testReady)}>
                <span className={`status-dot ${testReady ? 'ok' : 'warn'}`} />
                {testReady ? 'Passed' : 'Needed'}
              </span>
            </div>
            <div className="connections-checks">
              <span>
                <span className={`status-dot ${calendarState.writebackConfigured ? 'ok' : 'warn'}`} />
                writeback
              </span>
              <span>
                <span className={`status-dot ${calendarState.syncTestPassed ? 'ok' : 'warn'}`} />
                booking test
              </span>
              <span>
                <span className={`status-dot ${calendarState.launchApproved ? 'ok' : 'warn'}`} />
                launch approved
              </span>
            </div>
            <div className="tiny-muted">
              Keep this step as the final gate before calling the setup live.
            </div>
          </div>
        </section>

        {automationState.lastError ? (
          <div className="panel panel-dark panel-stack">
            <div className="metric-label">Last error</div>
            <div className="text-muted">{automationState.lastError}</div>
          </div>
        ) : null}
      </section>
    </LayoutShell>
  );
}
