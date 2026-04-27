import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { CopyableCodeBlock } from '@/app/clients/[id]/workflow/CopyableCodeBlock';
import { CopyableUrlField } from '@/app/clients/[id]/workflow/CopyableUrlField';
import { retryClientAutomationAction } from '@/app/clients/[id]/workflow/actions';
import { LayoutShell } from '@/app/components/LayoutShell';
import { emptyClientAutomationState, parseClientAutomationPayload } from '@/lib/client-automation';
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

  const [latestVoiceSetupEvent, latestAutomationEvent] = await Promise.all([
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
    )
  ]);

  const voiceState = latestVoiceSetupEvent
    ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload)
    : emptyTelnyxSetupState;
  const automationState = latestAutomationEvent
    ? parseClientAutomationPayload(latestAutomationEvent.payload)
    : emptyClientAutomationState;
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
            <h3 className="section-title">Voice assistant and booking automation</h3>
            <div className="record-subtitle">
              This page keeps the full call path together: how Telnyx should hand the booking out of the call and where n8n
              should send it inside Fix Your Leads.
            </div>
          </div>
          <span className={automationPresentation.toneClass}>
            <span className={`status-dot ${automationPresentation.dot}`} />
            {automationPresentation.label}
          </span>
        </div>

        <div className="panel-grid integration-page-grid">
          <section className="metric-card panel-stack">
            <div className="metric-label">What this page answers</div>
            <div className="metric-copy">
              What URL Telnyx should call, which client workflow receives the booking, and how the booking returns to Fix Your Leads.
            </div>
          </section>
          <section className="metric-card panel-stack">
            <div className="metric-label">Current route</div>
            <div className="metric-copy">
              {assistantRouteLabel({ hasN8nWebhook: usingN8nWebhook, hasDirectWebhook: Boolean(directVoiceWebhookTarget) })}
            </div>
          </section>
          <section className="metric-card panel-stack">
            <div className="metric-label">Operator action</div>
            <div className="metric-copy">
              Copy the Telnyx tool settings below, then use the automation section to confirm the client workflow is active.
            </div>
          </section>
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
            <div className="metric-label">Tool destination</div>
            <div className="metric-value" style={{ fontSize: '1rem' }}>
              {usingN8nWebhook ? 'n8n webhook' : 'Direct app fallback'}
            </div>
            <div className="metric-copy">
              {voiceWebhookTarget || 'No live destination is configured yet.'}
            </div>
          </section>
          <section className="metric-card panel-stack">
            <div className="metric-label">Last sync</div>
            <div className="metric-value" style={{ fontSize: '1rem' }}>
              {automationState.updatedAt ? new Date(automationState.updatedAt).toLocaleString() : '—'}
            </div>
            <div className="metric-copy">{automationState.notes || 'No connection notes yet.'}</div>
          </section>
        </div>

        <div className="panel panel-dark panel-stack">
          <div className="metric-label">What happens on a live call</div>
          <div className="status-list">
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${voiceWebhookTarget ? 'ok' : 'warn'}`} />
                1. Telnyx tool sends the booking request
              </span>
              <span className="text-muted">
                {voiceWebhookTarget || 'No live destination is configured yet.'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${automationState.configUrl ? 'ok' : 'warn'}`} />
                2. n8n loads the client config
              </span>
              <span className="text-muted">
                {automationState.configUrl || 'Client config URL is missing.'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">
                <span className={`status-dot ${automationState.bookingCreateUrl ? 'ok' : 'warn'}`} />
                3. Fix Your Leads writes the booking
              </span>
              <span className="text-muted">
                {automationState.bookingCreateUrl || 'Booking writeback URL is missing.'}
              </span>
            </div>
          </div>
        </div>

        <div className="status-list">
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${usingN8nWebhook ? 'ok' : 'warn'}`} />
              Recommended mode
            </span>
            <span className="text-muted">
              {usingN8nWebhook
                ? 'Telnyx should call the client-specific n8n webhook. n8n then loads client config and writes the booking back into Fix Your Leads.'
                : 'The client does not have a live n8n webhook yet, so the tool is falling back to the direct app booking webhook.'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${automationState.workflowActive ? 'ok' : 'warn'}`} />
              Workflow activation
            </span>
            <span className="text-muted">
              {automationState.workflowActive ? 'Workflow is marked active in n8n.' : 'Workflow is not active yet or still needs a manual check.'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${automationState.lastSuccessAt ? 'ok' : 'warn'}`} />
              Last successful run
            </span>
            <span className="text-muted">
              {automationState.lastSuccessAt
                ? `${new Date(automationState.lastSuccessAt).toLocaleString()} · ${formatAttemptLabel(automationState.source)}`
                : formatAttemptLabel(automationState.source)}
            </span>
          </div>
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

        <div className="panel-grid integration-page-grid">
          <section className="panel panel-dark panel-stack">
            <div className="metric-label">Automation endpoints</div>
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
              label="Booking writeback"
              defaultValue={automationState.bookingCreateUrl ?? undefined}
              fallbackCopyValue={automationState.bookingCreateUrl ?? undefined}
              copyButtonLabel="Copy URL"
              readOnly
            />
          </section>
          <section className="panel panel-dark panel-stack">
            <div className="metric-label">Direct app fallback</div>
            <div className="text-muted">
              Keep this only as a backup. It bypasses the client n8n workflow and sends bookings straight into Fix Your Leads.
            </div>
            <CopyableUrlField
              id="connections-direct-fallback-url"
              label="Fallback URL"
              defaultValue={directVoiceWebhookTarget}
              fallbackCopyValue={directVoiceWebhookTarget}
              copyButtonLabel="Copy URL"
              readOnly
            />
          </section>
        </div>

        {automationState.lastError ? (
          <div className="panel panel-dark panel-stack">
            <div className="metric-label">Last error</div>
            <div className="text-muted">{automationState.lastError}</div>
          </div>
        ) : null}

        <div className="action-cluster">
          {automationState.workflowEditorUrl ? (
            <a className="button-secondary" href={automationState.workflowEditorUrl} target="_blank" rel="noreferrer">
              Open in n8n
            </a>
          ) : null}
          {automationState.configUrl ? (
            <a className="button-ghost" href={automationState.configUrl} target="_blank" rel="noreferrer">
              Open config endpoint
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
    </LayoutShell>
  );
}
