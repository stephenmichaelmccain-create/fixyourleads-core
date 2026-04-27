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
  const step3Ready = Boolean(bookingPlatformLabel && automationState.bookingCreateUrl);
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
              ? 'The latest voice wiring and booking automation settings were saved.'
              : query.notice === 'automation_ready'
                ? 'The client workflow is active and ready for the next step.'
                : query.notice === 'automation_attention'
                  ? automationState.lastError || 'Something still needs a manual check in n8n or Railway.'
                  : automationState.lastError || 'Provisioning failed. Review the error below and retry after fixing the blocker.'}
          </div>
        </section>
      ) : null}

      <section className="panel panel-stack telnyx-page-panel">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Connections</div>
            <h3 className="section-title">Step-by-step setup</h3>
            <div className="record-subtitle">
              Follow these steps in order. When Step 4 is done, the client's booking system should be connected and working.
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
              <h4 className="section-title" style={{ marginBottom: 4 }}>Get the client workflow live</h4>
              <div className="text-muted">Do not continue until the workflow is active.</div>
            </div>
            <span className={stepTone(step1Ready)}>
              <span className={`status-dot ${step1Ready ? 'ok' : 'warn'}`} />
              {step1Ready ? 'Done' : 'Do this first'}
            </span>
          </div>

          <div className="status-list">
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${automationState.workflowActive ? 'ok' : 'warn'}`} />
                Workflow
              </span>
              <span className="text-muted">{automationState.workflowName || 'No workflow provisioned yet.'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${voiceWebhookTarget ? 'ok' : 'warn'}`} />
                Webhook URL
              </span>
              <span className="text-muted">{voiceWebhookTarget || 'No live destination yet.'}</span>
            </div>
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
              <h4 className="section-title" style={{ marginBottom: 4 }}>Paste these into Telnyx</h4>
              <div className="text-muted">Create or update the booking tool in the client's Telnyx assistant with these values.</div>
            </div>
            <span className={stepTone(step2Ready)}>
              <span className={`status-dot ${step2Ready ? 'ok' : 'warn'}`} />
              {step2Ready ? 'Ready' : 'Missing destination'}
            </span>
          </div>

          <CopyableUrlField
            id="connections-tool-name"
            label="Tool name"
            defaultValue={telnyxToolName}
            fallbackCopyValue={telnyxToolName}
            copyButtonLabel="Copy"
            readOnly
          />
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
          <CopyableUrlField
            id="connections-tool-description"
            label="Tool description"
            defaultValue={telnyxToolDescription}
            fallbackCopyValue={telnyxToolDescription}
            copyButtonLabel="Copy"
            readOnly
          />

          {usingN8nWebhook ? (
            <div className="text-muted">Headers are not required for the client n8n webhook.</div>
          ) : (
            <>
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
            </>
          )}

          <CopyableCodeBlock label="Body schema" value={telnyxBodyParameterSchema} copyButtonLabel="Copy JSON" />
        </section>

        <section className="panel panel-dark panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Step 3</div>
              <h4 className="section-title" style={{ marginBottom: 4 }}>Connect the real booking system in n8n</h4>
              <div className="text-muted">Inside the workflow, connect the client's real booking system and keep the writeback URL at the end.</div>
            </div>
            <span className={stepTone(step3Ready)}>
              <span className={`status-dot ${step3Ready ? 'ok' : 'warn'}`} />
              {step3Ready ? 'Ready to test' : 'Set this up'}
            </span>
          </div>

          <CopyableUrlField
            id="connections-booking-platform"
            label="Booking platform"
            defaultValue={bookingPlatformLabel || 'Not chosen yet'}
            fallbackCopyValue={bookingPlatformLabel || 'Not chosen yet'}
            copyButtonLabel="Copy"
            readOnly
          />
          <CopyableUrlField
            id="connections-config-url"
            label="Client config endpoint"
            defaultValue={automationState.configUrl ?? undefined}
            fallbackCopyValue={automationState.configUrl ?? undefined}
            copyButtonLabel="Copy URL"
            readOnly
          />
          <CopyableUrlField
            id="connections-booking-writeback"
            label="Booking writeback URL"
            defaultValue={automationState.bookingCreateUrl ?? undefined}
            fallbackCopyValue={automationState.bookingCreateUrl ?? undefined}
            copyButtonLabel="Copy URL"
            readOnly
          />

          <div className="action-cluster">
            {automationState.workflowEditorUrl ? (
              <a className="button-secondary" href={automationState.workflowEditorUrl} target="_blank" rel="noreferrer">
                Open workflow
              </a>
            ) : null}
            {calendarState.externalPlatformUrl ? (
              <a className="button-ghost" href={calendarState.externalPlatformUrl} target="_blank" rel="noreferrer">
                Open booking system
              </a>
            ) : null}
          </div>
        </section>

        <section className="panel panel-dark panel-stack">
          <div className="record-header">
            <div>
              <div className="metric-label">Step 4</div>
              <h4 className="section-title" style={{ marginBottom: 4 }}>Run one test booking</h4>
              <div className="text-muted">The test should land in the real booking system and in Fix Your Leads.</div>
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
                Booking writes back
              </span>
              <span className="text-muted">{calendarState.writebackConfigured ? 'Yes' : 'Not confirmed yet'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${calendarState.syncTestPassed ? 'ok' : 'warn'}`} />
                Test booking passed
              </span>
              <span className="text-muted">{calendarState.syncTestPassed ? 'Yes' : 'Not confirmed yet'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${calendarState.launchApproved ? 'ok' : 'warn'}`} />
                Launch approved
              </span>
              <span className="text-muted">{calendarState.launchApproved ? 'Yes' : 'Not approved yet'}</span>
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
