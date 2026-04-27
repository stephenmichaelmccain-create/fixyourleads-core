import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { CopyableCodeBlock } from '@/app/clients/[id]/workflow/CopyableCodeBlock';
import { CopyableUrlField } from '@/app/clients/[id]/workflow/CopyableUrlField';
import { retryClientAutomationAction, saveClientWorkflowAction } from '@/app/clients/[id]/workflow/actions';
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

function buildTelnyxBodyParameterSchema(input: {
  companyId: string;
  businessName: string;
  calledNumber: string | null;
  telnyxAssistantId: string | null;
}) {
  return JSON.stringify(
    {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Caller phone number in E.164 format'
        },
        startTime: {
          type: 'string',
          description: 'Appointment start time in ISO 8601 format'
        },
        companyId: {
          type: 'string',
          description: 'Fix Your Leads client workspace ID',
          default: input.companyId
        },
        calledNumber: {
          type: 'string',
          description: 'Client voice line used for routing',
          default: input.calledNumber || '+13035550199'
        },
        telnyxAssistantId: {
          type: 'string',
          description: 'Optional Telnyx assistant ID for routing',
          default: input.telnyxAssistantId || ''
        },
        fullName: {
          type: 'string',
          description: 'Caller full name'
        },
        email: {
          type: 'string',
          description: 'Caller email address'
        },
        purpose: {
          type: 'string',
          description: 'Reason for the booking'
        },
        notes: {
          type: 'string',
          description: 'Booking notes for the team'
        },
        meetingUrl: {
          type: 'string',
          description: 'Optional meeting link'
        },
        displayCompanyName: {
          type: 'string',
          description: 'Calendar-facing business name',
          default: input.businessName
        }
      },
      required: ['phone', 'startTime'],
      additionalProperties: true
    },
    null,
    2
  );
}

function buildAvailabilityBodyParameterSchema(input: {
  companyId: string;
  calledNumber: string | null;
  telnyxAssistantId: string | null;
}) {
  return JSON.stringify(
    {
      type: 'object',
      properties: {
        startTime: {
          type: 'string',
          description: 'Requested appointment time in ISO 8601 format'
        },
        durationMinutes: {
          type: 'number',
          description: 'Optional appointment length in minutes',
          default: 60
        },
        companyId: {
          type: 'string',
          description: 'Fix Your Leads client workspace ID',
          default: input.companyId
        },
        calledNumber: {
          type: 'string',
          description: 'Client voice line used for routing',
          default: input.calledNumber || '+13035550199'
        },
        telnyxAssistantId: {
          type: 'string',
          description: 'Optional Telnyx assistant ID for routing',
          default: input.telnyxAssistantId || ''
        }
      },
      required: ['startTime'],
      additionalProperties: true
    },
    null,
    2
  );
}

function buildCancelBodyParameterSchema(input: {
  companyId: string;
  calledNumber: string | null;
  telnyxAssistantId: string | null;
}) {
  return JSON.stringify(
    {
      type: 'object',
      properties: {
        appointmentId: {
          type: 'string',
          description: 'Known appointment ID if the caller has one'
        },
        phone: {
          type: 'string',
          description: 'Caller phone number in E.164 format'
        },
        startTime: {
          type: 'string',
          description: 'Optional appointment start time if the caller is canceling a specific slot'
        },
        reason: {
          type: 'string',
          description: 'Optional cancellation reason'
        },
        companyId: {
          type: 'string',
          description: 'Fix Your Leads client workspace ID',
          default: input.companyId
        },
        calledNumber: {
          type: 'string',
          description: 'Client voice line used for routing',
          default: input.calledNumber || '+13035550199'
        },
        telnyxAssistantId: {
          type: 'string',
          description: 'Optional Telnyx assistant ID for routing',
          default: input.telnyxAssistantId || ''
        }
      },
      required: ['phone'],
      additionalProperties: true
    },
    null,
    2
  );
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
      title: 'MCP workflow ready.',
      detail: 'Connect the Telnyx assistant to the n8n MCP server URL, then run one real booking test.',
      toneClass: 'status-chip status-chip-muted',
      dot: 'warn'
    };
  }

  if (input.platformConfigured) {
    return {
      label: 'Ready to launch',
      title: 'Booking system saved.',
      detail: 'Launch the n8n MCP workflow, then connect the assistant in Telnyx.',
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
  const availabilityToolUrl = appBaseUrl ? `${appBaseUrl}/api/webhooks/voice/check-availability` : '';
  const cancelToolUrl = appBaseUrl ? `${appBaseUrl}/api/webhooks/voice/cancel` : '';
  const voiceWebhookSecret =
    process.env.VOICE_BOOKING_WEBHOOK_SECRET?.trim() ||
    process.env.VOICE_DEMO_WEBHOOK_SECRET?.trim() ||
    process.env.INTERNAL_API_KEY?.trim() ||
    '';
  const availabilityBodyParameterSchema = buildAvailabilityBodyParameterSchema({
    companyId: company.id,
    calledNumber: voiceState.phoneNumber,
    telnyxAssistantId: company.telnyxAssistantId
  });
  const telnyxBodyParameterSchema = buildTelnyxBodyParameterSchema({
    companyId: company.id,
    businessName: company.name,
    calledNumber: voiceState.phoneNumber,
    telnyxAssistantId: company.telnyxAssistantId
  });
  const cancelBodyParameterSchema = buildCancelBodyParameterSchema({
    companyId: company.id,
    calledNumber: voiceState.phoneNumber,
    telnyxAssistantId: company.telnyxAssistantId
  });
  const mcpServerName = `${company.name} voice mcp`;
  const availabilityToolName = 'check_availability';
  const bookingToolName = 'book_appointment';
  const cancelToolName = 'cancel_appointment';
  const telnyxHeaderName = 'X-Voice-Webhook-Secret';
  const mcpAllowedTools = JSON.stringify([availabilityToolName, bookingToolName, cancelToolName], null, 2);
  const bookingPlatformLabel =
    calendarState.externalPlatformName ||
    (calendarState.connectionMode === 'google_calendar'
      ? 'Google Calendar'
      : calendarState.connectionMode === 'external_booking'
        ? 'External booking platform'
        : null);
  const platformConfigured = Boolean(bookingPlatformLabel || calendarState.externalPlatformUrl || bookingCredentialsSaved);
  const workflowReady = Boolean(automationState.workflowActive && automationState.workflowEditorUrl);
  const telnyxReady = Boolean(workflowReady && automationState.workflowEditorUrl);
  const testReady = Boolean(calendarState.syncTestPassed && calendarState.launchApproved);
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
                : query.notice === 'automation_attention'
                  ? 'MCP workflow needs one more check.'
                  : 'Connection setup failed.'}
          </h2>
          <div className="text-muted">
            {query.notice === 'updated'
              ? 'The booking system was saved and the n8n workflow was updated.'
              : query.notice === 'automation_ready'
                ? 'The client workflow is active. Connect Telnyx to the n8n MCP server URL, then run one test booking.'
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
                  <h4 className="section-title">Choose system</h4>
                  <div className="tiny-muted">Where availability, booking, and cancellation actually happen.</div>
                </div>
                <span className={stepTone(platformConfigured)}>
                  <span className={`status-dot ${platformConfigured ? 'ok' : 'warn'}`} />
                  {platformConfigured ? 'Saved' : 'Needed'}
                </span>
              </div>
              <div className="workspace-filter-row">
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="connections-booking-platform">
                    Primary platform
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
                    API key or token
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
                    Secret or second key
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
              <details className="connections-secondary">
                <summary className="details-summary">Secondary system</summary>
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
                  <div className="tiny-muted">Creates or updates this client's workflow from Fix Your Leads.</div>
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
                <div className="tiny-muted">Add one MCP server to the Telnyx assistant. The tools stay the same for every client.</div>
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
            </div>
            <div className="tiny-muted">The MCP server URL comes from the n8n MCP Server Trigger after launch.</div>
          </div>
        </section>

        <section className="connections-step">
          <div className="connections-step-number">4</div>
          <div className="connections-step-body">
            <div className="connections-step-head">
              <div>
                <h4 className="section-title">Test booking</h4>
                <div className="tiny-muted">One real call should check a slot, book it, and cancel or reschedule cleanly.</div>
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
          </div>
        </section>

        <details className="connections-advanced">
          <summary className="details-summary">Advanced setup details</summary>
          <div className="connections-advanced-grid">
            <CopyableUrlField
              id="connections-mcp-shared-secret"
              label="Fix Your Leads shared secret"
              defaultValue={voiceWebhookSecret}
              placeholder="Set VOICE_BOOKING_WEBHOOK_SECRET or INTERNAL_API_KEY in Railway"
              fallbackCopyValue={voiceWebhookSecret}
              copyButtonLabel="Copy secret"
              readOnly
            />
            <CopyableCodeBlock label="Allowed MCP tools" value={mcpAllowedTools} copyButtonLabel="Copy JSON" />
            <CopyableUrlField
              id="connections-availability-tool-url"
              label="Availability endpoint"
              defaultValue={availabilityToolUrl}
              fallbackCopyValue={availabilityToolUrl}
              copyButtonLabel="Copy URL"
              readOnly
            />
            <CopyableCodeBlock label="Availability schema" value={availabilityBodyParameterSchema} copyButtonLabel="Copy JSON" />
            <CopyableUrlField
              id="connections-booking-writeback"
              label="Booking writeback URL"
              defaultValue={automationState.bookingCreateUrl ?? undefined}
              fallbackCopyValue={automationState.bookingCreateUrl ?? undefined}
              copyButtonLabel="Copy URL"
              readOnly
            />
            <CopyableCodeBlock label="Booking schema" value={telnyxBodyParameterSchema} copyButtonLabel="Copy JSON" />
            <CopyableUrlField
              id="connections-cancel-tool-url"
              label="Cancel endpoint"
              defaultValue={cancelToolUrl}
              fallbackCopyValue={cancelToolUrl}
              copyButtonLabel="Copy URL"
              readOnly
            />
            <CopyableCodeBlock label="Cancel schema" value={cancelBodyParameterSchema} copyButtonLabel="Copy JSON" />
            <CopyableUrlField
              id="connections-config-url"
              label="Client config endpoint"
              defaultValue={automationState.configUrl ?? undefined}
              fallbackCopyValue={automationState.configUrl ?? undefined}
              copyButtonLabel="Copy URL"
              readOnly
            />
            <CopyableUrlField
              id="connections-header-name"
              label="Fix Your Leads auth header"
              defaultValue={telnyxHeaderName}
              fallbackCopyValue={telnyxHeaderName}
              copyButtonLabel="Copy"
              readOnly
            />
          </div>
        </details>

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
