import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { CopyableCodeBlock } from '@/app/clients/[id]/workflow/CopyableCodeBlock';
import { CopyableUrlField } from '@/app/clients/[id]/workflow/CopyableUrlField';
import { retryClientAutomationAction } from '@/app/clients/[id]/workflow/actions';
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

function formatAttemptLabel(source: string | null) {
  if (source === 'signup_approval') {
    return 'Created during client approval';
  }

  if (source === 'workflow_save') {
    return 'Re-ran after setup changes';
  }

  if (source === 'manual_retry') {
    return 'Re-ran from the connections page';
  }

  return 'No provisioning attempts yet';
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
      notes: 'Booked by AI voice agent after qualifying the caller.'
    },
    null,
    2
  );
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

function assistantRouteLabel(input: {
  hasN8nWebhook: boolean;
  hasDirectWebhook: boolean;
}) {
  if (input.hasN8nWebhook) {
    return 'Preferred: Telnyx tool → client n8n webhook → Fix Your Leads';
  }

  if (input.hasDirectWebhook) {
    return 'Fallback: Telnyx tool → direct Fix Your Leads webhook';
  }

  return 'No live destination is ready yet';
}

function stepTone(isReady: boolean) {
  return isReady ? 'status-chip status-chip-confirmed' : 'status-chip status-chip-muted';
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

  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || null;
  const directVoiceWebhookTarget = voiceState.webhookUrl || (appBaseUrl ? `${appBaseUrl}/api/webhooks/voice/appointments` : '');
  const voiceWebhookTarget = automationState.workflowWebhookUrl || directVoiceWebhookTarget;
  const voiceWebhookSecret =
    process.env.VOICE_BOOKING_WEBHOOK_SECRET?.trim() ||
    process.env.VOICE_DEMO_WEBHOOK_SECRET?.trim() ||
    process.env.INTERNAL_API_KEY?.trim() ||
    '';
  const voiceWebhookExamplePayload = buildVoiceWebhookExamplePayload({
    companyId: company.id,
    businessName: company.name,
    calledNumber: voiceState.phoneNumber
  });
  const telnyxBodyParameterSchema = buildTelnyxBodyParameterSchema({
    companyId: company.id,
    businessName: company.name,
    calledNumber: voiceState.phoneNumber,
    telnyxAssistantId: company.telnyxAssistantId
  });
  const telnyxToolName = 'fyl_book_call';
  const telnyxToolDescription = `Book a ${company.name} discovery call after availability is confirmed. Only use this after confirming the slot with the caller.`;
  const telnyxHeaderName = 'X-Voice-Webhook-Secret';
  const usingN8nWebhook = Boolean(automationState.workflowWebhookUrl);
  const bookingPlatformLabel =
    calendarState.externalPlatformName ||
    (calendarState.connectionMode === 'google_calendar'
      ? 'Google Calendar'
      : calendarState.connectionMode === 'external_booking'
        ? 'External booking platform'
        : null);
  const step1Ready = Boolean(automationState.workflowActive && voiceWebhookTarget);
  const step2Ready = Boolean(voiceWebhookTarget);
  const step3Ready = Boolean(
    bookingPlatformLabel &&
      (calendarState.externalPlatformReviewed || calendarState.writebackConfigured || calendarState.googleOauthConnected)
  );
  const step4Ready = Boolean(calendarState.syncTestPassed && calendarState.launchApproved);

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
              ? 'Connection settings saved.'
              : query.notice === 'automation_ready'
                ? 'Connections are live.'
                : query.notice === 'automation_attention'
                  ? 'Connections need one more check.'
                  : 'Connection setup failed.'}
          </h2>
          <div className="text-muted">
            {query.notice === 'updated'
              ? 'The latest voice wiring and booking automation settings were saved, and provisioning re-ran in the background.'
              : query.notice === 'automation_ready'
                ? 'The shared n8n workflow is active and ready to receive Telnyx tool calls.'
                : query.notice === 'automation_attention'
                  ? automationState.lastError || 'Provisioning ran, but something still needs a manual check in n8n or Railway.'
                  : automationState.lastError || 'Provisioning failed. Review the error below and retry after fixing the blocker.'}
          </div>
        </section>
      ) : null}

      <section className="panel panel-stack telnyx-page-panel">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Connections</div>
            <h3 className="section-title">Set this client up from top to bottom</h3>
            <div className="record-subtitle">
              Work down this page in order. When you finish the last step, the client's booking system should be wired and ready for live calls.
            </div>
          </div>
          <span className={automationPresentation.toneClass}>
            <span className={`status-dot ${automationPresentation.dot}`} />
            {automationPresentation.label}
          </span>
        </div>

        <section className="panel panel-dark panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Step 1</div>
              <h4 className="section-title" style={{ marginBottom: 4 }}>Make sure the shared workflow is live</h4>
              <div className="text-muted">This gives the client a dedicated n8n webhook for voice bookings.</div>
            </div>
            <span className={stepTone(step1Ready)}>
              <span className={`status-dot ${step1Ready ? 'ok' : 'warn'}`} />
              {step1Ready ? 'Done' : 'Do this first'}
            </span>
          </div>
          <div className="metric-grid">
            <section className="metric-card panel-stack">
              <div className="metric-label">Workflow</div>
              <div className="metric-value" style={{ fontSize: '1rem' }}>
                {automationState.workflowId ? automationState.workflowId.slice(-10) : '—'}
              </div>
              <div className="metric-copy">{automationState.workflowName || 'No n8n workflow has been provisioned yet.'}</div>
            </section>
            <section className="metric-card panel-stack">
              <div className="metric-label">Status</div>
              <div className="metric-value" style={{ fontSize: '1rem' }}>
                {automationState.workflowActive ? 'Active' : 'Not active'}
              </div>
              <div className="metric-copy">
                {automationState.lastSuccessAt
                  ? `${new Date(automationState.lastSuccessAt).toLocaleString()} · ${formatAttemptLabel(automationState.source)}`
                  : formatAttemptLabel(automationState.source)}
              </div>
            </section>
            <section className="metric-card panel-stack">
              <div className="metric-label">Webhook route</div>
              <div className="metric-value" style={{ fontSize: '1rem' }}>
                {usingN8nWebhook ? 'Client n8n webhook' : 'Direct fallback'}
              </div>
              <div className="metric-copy">{assistantRouteLabel({ hasN8nWebhook: usingN8nWebhook, hasDirectWebhook: Boolean(directVoiceWebhookTarget) })}</div>
            </section>
          </div>
          <div className="action-cluster">
            {automationState.workflowEditorUrl ? (
              <a className="button-secondary" href={automationState.workflowEditorUrl} target="_blank" rel="noreferrer">
                Open in n8n
              </a>
            ) : null}
            <form action={retryClientAutomationAction}>
              <input type="hidden" name="companyId" value={company.id} />
              <button type="submit" className="button-ghost">
                Retry provisioning
              </button>
            </form>
          </div>
        </section>

        <section className="panel panel-dark panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Step 2</div>
              <h4 className="section-title" style={{ marginBottom: 4 }}>Paste this into the Telnyx booking tool</h4>
              <div className="text-muted">Copy these values into the client's voice assistant so calls send structured bookings into the right destination.</div>
            </div>
            <span className={stepTone(step2Ready)}>
              <span className={`status-dot ${step2Ready ? 'ok' : 'warn'}`} />
              {step2Ready ? 'Ready to paste' : 'Missing destination'}
            </span>
          </div>

          <div className="telnyx-editor-shell">
          <div className="telnyx-editor-grid">
            <CopyableUrlField
              id="connections-tool-name"
              label="Telnyx tool name"
              defaultValue={telnyxToolName}
              fallbackCopyValue={telnyxToolName}
              copyButtonLabel="Copy"
              readOnly
            />
            <CopyableUrlField
              id="connections-tool-description"
              label="Tool description"
              defaultValue={telnyxToolDescription}
              fallbackCopyValue={telnyxToolDescription}
              copyButtonLabel="Copy"
              readOnly
            />
            <div className="telnyx-editor-two-up">
              <CopyableUrlField
                id="connections-request-mode"
                label="Request Mode"
                defaultValue="Sync"
                fallbackCopyValue="Sync"
                copyButtonLabel="Copy"
                readOnly
              />
              <CopyableUrlField
                id="connections-timeout"
                label="Timeout (ms)"
                defaultValue="10000"
                fallbackCopyValue="10000"
                copyButtonLabel="Copy"
                readOnly
              />
            </div>
            <div className="telnyx-editor-two-up">
              <CopyableUrlField
                id="connections-method"
                label="Method"
                defaultValue="POST"
                fallbackCopyValue="POST"
                copyButtonLabel="Copy"
                readOnly
              />
              <CopyableUrlField
                id="connections-webhook-url"
                label="Tool URL"
                defaultValue={voiceWebhookTarget}
                fallbackCopyValue={voiceWebhookTarget}
                copyButtonLabel="Copy URL"
                readOnly
              />
            </div>
          </div>

          <div className="telnyx-tab-row" aria-hidden="true">
            <span className="telnyx-tab-pill is-active">Headers</span>
            <span className="telnyx-tab-pill">Body Parameters</span>
            <span className="telnyx-tab-pill">Automation</span>
          </div>

          <div className="telnyx-editor-section">
            <div className="metric-label">Headers</div>
            {usingN8nWebhook ? (
              <div className="panel panel-dark panel-stack">
                <div className="text-muted">
                  No custom header is required for the client n8n webhook. Paste the URL above into Telnyx and send the JSON
                  body directly.
                </div>
                {directVoiceWebhookTarget ? (
                  <div className="tiny-muted">
                    If you ever bypass n8n and send Telnyx straight to the app webhook, switch to the direct fallback below and
                    include <code>{telnyxHeaderName}</code>.
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="telnyx-editor-two-up">
                  <CopyableUrlField
                    id="connections-header-name"
                    label="Header name"
                    defaultValue={telnyxHeaderName}
                    fallbackCopyValue={telnyxHeaderName}
                    copyButtonLabel="Copy"
                    readOnly
                  />
                  <CopyableUrlField
                    id="connections-header-value"
                    label="Header value"
                    defaultValue={voiceWebhookSecret}
                    placeholder="Set VOICE_BOOKING_WEBHOOK_SECRET or INTERNAL_API_KEY in Railway"
                    fallbackCopyValue={voiceWebhookSecret}
                    copyButtonLabel="Copy secret"
                    readOnly
                  />
                </div>
                {!voiceWebhookSecret ? (
                  <div className="text-muted">
                    No shared webhook secret is configured yet. Add `VOICE_BOOKING_WEBHOOK_SECRET` in Railway, or the app will use
                    `INTERNAL_API_KEY` once that exists.
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="telnyx-editor-section">
            <div className="metric-label">Body parameters</div>
            <CopyableCodeBlock label="Body parameter schema" value={telnyxBodyParameterSchema} copyButtonLabel="Copy JSON" />
            <CopyableCodeBlock label="Example request body" value={voiceWebhookExamplePayload} copyButtonLabel="Copy example" />
          </div>
          </div>
        </section>

        <section className="panel panel-dark panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Step 3</div>
              <h4 className="section-title" style={{ marginBottom: 4 }}>Connect the client's real booking system in n8n</h4>
              <div className="text-muted">Open the workflow, add the provider branch or credentials, and make sure the booking writes back into Fix Your Leads.</div>
            </div>
            <span className={stepTone(step3Ready)}>
              <span className={`status-dot ${step3Ready ? 'ok' : 'warn'}`} />
              {step3Ready ? 'In progress' : 'Needs provider setup'}
            </span>
          </div>
          <div className="metric-grid">
            <section className="metric-card panel-stack">
              <div className="metric-label">Booking platform</div>
              <div className="metric-value" style={{ fontSize: '1rem' }}>
                {bookingPlatformLabel || 'Not chosen'}
              </div>
              <div className="metric-copy">
                {calendarState.connectionMode
                  ? `Connection mode: ${calendarState.connectionMode.replace(/_/g, ' ')}`
                  : 'Choose the provider and save its connection details from the client setup flow.'}
              </div>
            </section>
            <section className="metric-card panel-stack">
              <div className="metric-label">Client config endpoint</div>
              <div className="metric-copy">
                n8n loads the client settings from this endpoint before writing the booking back.
              </div>
              <CopyableUrlField
                id="connections-config-url"
                label="Config URL"
                defaultValue={automationState.configUrl ?? undefined}
                fallbackCopyValue={automationState.configUrl ?? undefined}
                copyButtonLabel="Copy URL"
                readOnly
              />
            </section>
            <section className="metric-card panel-stack">
              <div className="metric-label">Booking writeback</div>
              <div className="metric-copy">
                Keep this connected at the end of the workflow so successful bookings land in Fix Your Leads.
              </div>
              <CopyableUrlField
                id="connections-booking-writeback"
                label="Writeback URL"
                defaultValue={automationState.bookingCreateUrl ?? undefined}
                fallbackCopyValue={automationState.bookingCreateUrl ?? undefined}
                copyButtonLabel="Copy URL"
                readOnly
              />
            </section>
          </div>
          {calendarState.externalPlatformUrl ? (
            <a className="button-ghost" href={calendarState.externalPlatformUrl} target="_blank" rel="noreferrer">
              Open booking system
            </a>
          ) : null}
        </section>

        <section className="panel panel-dark panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Step 4</div>
              <h4 className="section-title" style={{ marginBottom: 4 }}>Test one real booking and mark it ready</h4>
              <div className="text-muted">Run a test call or website booking, then confirm the booking appears in the client's real system and in Fix Your Leads.</div>
            </div>
            <span className={stepTone(step4Ready)}>
              <span className={`status-dot ${step4Ready ? 'ok' : 'warn'}`} />
              {step4Ready ? 'Connected and working' : 'Still needs a test'}
            </span>
          </div>
          <div className="status-list">
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${calendarState.writebackConfigured ? 'ok' : 'warn'}`} />
                Writeback configured
              </span>
              <span className="text-muted">
                {calendarState.writebackConfigured
                  ? 'The provider workflow is set to send the final booking back into Fix Your Leads.'
                  : 'Finish the writeback step inside n8n before launch.'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${calendarState.syncTestPassed ? 'ok' : 'warn'}`} />
                Test passed
              </span>
              <span className="text-muted">
                {calendarState.syncTestPassed
                  ? 'A test booking has already been confirmed.'
                  : 'Place one test booking and confirm it lands in both the provider and Fix Your Leads.'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${calendarState.launchApproved ? 'ok' : 'warn'}`} />
                Launch approved
              </span>
              <span className="text-muted">
                {calendarState.launchApproved
                  ? 'This client is marked ready for live traffic.'
                  : 'Mark launch approved after the test booking is clean.'}
              </span>
            </div>
          </div>
        </section>

        {automationState.lastError ? (
          <div className="panel panel-dark panel-stack">
            <div className="metric-label">Last error</div>
            <div className="text-muted">{automationState.lastError}</div>
          </div>
        ) : null}

        <section className="panel panel-dark panel-stack">
          <div className="metric-label">Backup tools</div>
          <div className="text-muted">
            Use these only if you need to inspect the raw wiring or fall back temporarily while you finish the provider setup.
          </div>
          <CopyableUrlField
            id="connections-direct-fallback-url"
            label="Direct app fallback"
            defaultValue={directVoiceWebhookTarget}
            fallbackCopyValue={directVoiceWebhookTarget}
            copyButtonLabel="Copy URL"
            readOnly
          />
          {automationState.configUrl ? (
            <a className="button-ghost" href={automationState.configUrl} target="_blank" rel="noreferrer">
              Open config endpoint
            </a>
          ) : null}
        </section>
      </section>
    </LayoutShell>
  );
}
