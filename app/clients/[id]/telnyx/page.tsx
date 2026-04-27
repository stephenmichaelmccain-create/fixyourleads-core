import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { CopyableCodeBlock } from '@/app/clients/[id]/workflow/CopyableCodeBlock';
import { CopyableUrlField } from '@/app/clients/[id]/workflow/CopyableUrlField';
import { LayoutShell } from '@/app/components/LayoutShell';
import { emptyClientAutomationState, parseClientAutomationPayload } from '@/lib/client-automation';
import { db } from '@/lib/db';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

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

export default async function LegacyClientTelnyxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  const latestVoiceSetupEvent = await safeLoad(
    () =>
      db.eventLog.findFirst({
        where: { companyId: id, eventType: 'client_telnyx_setup_updated' },
        orderBy: { createdAt: 'desc' },
        select: { payload: true }
      }),
    null
  );
  const latestAutomationEvent = await safeLoad(
    () =>
      db.eventLog.findFirst({
        where: { companyId: id, eventType: 'client_automation_updated' },
        orderBy: { createdAt: 'desc' },
        select: { payload: true }
      }),
    null
  );

  const voiceState = latestVoiceSetupEvent
    ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload)
    : emptyTelnyxSetupState;
  const automationState = latestAutomationEvent
    ? parseClientAutomationPayload(latestAutomationEvent.payload)
    : emptyClientAutomationState;

  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || null;
  const voiceWebhookSecret =
    process.env.VOICE_BOOKING_WEBHOOK_SECRET?.trim() ||
    process.env.VOICE_DEMO_WEBHOOK_SECRET?.trim() ||
    process.env.INTERNAL_API_KEY?.trim() ||
    '';
  const directVoiceWebhookTarget = voiceState.webhookUrl || (appBaseUrl ? `${appBaseUrl}/api/webhooks/voice/appointments` : '');
  const voiceWebhookTarget = automationState.workflowWebhookUrl || directVoiceWebhookTarget;
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
      title={`${company.name} · Telnyx`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="telnyx" />

      <section className="panel panel-stack telnyx-page-panel">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Telnyx</div>
            <h3 className="section-title">Assistant wiring for Telnyx</h3>
            <div className="record-subtitle">
              Use this page when you are inside the Telnyx assistant. Copy these fields into the tool so the assistant knows
              where to send booking requests after the call.
            </div>
          </div>
          <span className={usingN8nWebhook ? 'status-chip status-chip-confirmed' : 'status-chip status-chip-muted'}>
            <span className={`status-dot ${usingN8nWebhook ? 'ok' : 'warn'}`} />
            {usingN8nWebhook ? 'Using n8n webhook' : 'Using direct app fallback'}
          </span>
        </div>

        <div className="panel-grid integration-page-grid">
          <section className="metric-card panel-stack">
            <div className="metric-label">This page is for</div>
            <div className="metric-copy">
              Pasting the exact tool fields into Telnyx so the voice assistant can hand bookings out of the call.
            </div>
          </section>
          <section className="metric-card panel-stack">
            <div className="metric-label">n8n lives on</div>
            <div className="metric-copy">
              Use the <strong>n8n</strong> tab to confirm the workflow is provisioned, active, and ready to receive this tool call.
            </div>
          </section>
          <section className="metric-card panel-stack">
            <div className="metric-label">Current route</div>
            <div className="metric-copy">{assistantRouteLabel({ hasN8nWebhook: usingN8nWebhook, hasDirectWebhook: Boolean(directVoiceWebhookTarget) })}</div>
          </section>
        </div>

        <div className="status-list">
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${voiceWebhookTarget ? 'ok' : 'warn'}`} />
              Tool destination
            </span>
            <span className="text-muted">
              {voiceWebhookTarget || 'No live destination is configured yet.'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${usingN8nWebhook ? 'ok' : 'warn'}`} />
              Recommended mode
            </span>
            <span className="text-muted">
              {usingN8nWebhook
                ? 'Telnyx should call the client-specific n8n webhook. n8n then loads client config and writes the booking back into Fix Your Leads.'
                : 'The client does not have a live n8n webhook yet, so this page is falling back to the direct app booking webhook.'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${automationState.workflowEditorUrl ? 'ok' : 'warn'}`} />
              Workflow reference
            </span>
            <span className="text-muted">
              {automationState.workflowEditorUrl || 'Open the n8n tab to provision the workflow before wiring Telnyx.'}
            </span>
          </div>
        </div>

        <div className="telnyx-editor-shell">
          <div className="telnyx-editor-grid">
            <CopyableUrlField
              id="telnyx-tool-name"
              label="Name"
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
            <div className="telnyx-editor-two-up">
              <CopyableUrlField
                id="telnyx-request-mode"
                label="Request Mode"
                defaultValue="Sync"
                fallbackCopyValue="Sync"
                copyButtonLabel="Copy"
                readOnly
              />
              <CopyableUrlField
                id="telnyx-timeout"
                label="Timeout (ms)"
                defaultValue="10000"
                fallbackCopyValue="10000"
                copyButtonLabel="Copy"
                readOnly
              />
            </div>
            <div className="telnyx-editor-two-up">
              <CopyableUrlField
                id="telnyx-method"
                label="Method"
                defaultValue="POST"
                fallbackCopyValue="POST"
                copyButtonLabel="Copy"
                readOnly
              />
              <CopyableUrlField
                id="telnyx-webhook-url"
                label="URL"
                defaultValue={voiceWebhookTarget}
                fallbackCopyValue={voiceWebhookTarget}
                copyButtonLabel="Copy URL"
                readOnly
              />
            </div>
          </div>

          <div className="telnyx-tab-row" aria-hidden="true">
            <span className="telnyx-tab-pill is-active">Headers</span>
            <span className="telnyx-tab-pill">Path Parameters</span>
            <span className="telnyx-tab-pill">Query Parameters</span>
            <span className="telnyx-tab-pill">Body Parameters</span>
            <span className="telnyx-tab-pill">Dynamic Variable Assignments</span>
          </div>

          <div className="telnyx-editor-section">
            <div className="metric-label">Headers</div>
            {usingN8nWebhook ? (
              <div className="panel panel-dark panel-stack">
                <div className="text-muted">
                  No custom header is required for the shared n8n webhook. Paste the URL above into Telnyx and send the JSON
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
                    id="telnyx-header-name"
                    label="Header Name"
                    defaultValue={telnyxHeaderName}
                    fallbackCopyValue={telnyxHeaderName}
                    copyButtonLabel="Copy"
                    readOnly
                  />
                  <CopyableUrlField
                    id="telnyx-header-value"
                    label="Header Value"
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
            <div className="metric-label">Body Parameters</div>
            <CopyableCodeBlock label="Body parameter schema" value={telnyxBodyParameterSchema} copyButtonLabel="Copy JSON" />
            <CopyableCodeBlock label="Example request body" value={voiceWebhookExamplePayload} copyButtonLabel="Copy example" />
          </div>
        </div>

        <div className="panel-grid integration-page-grid">
          <section className="panel panel-dark panel-stack">
            <div className="metric-label">Direct app fallback</div>
            <div className="text-muted">
              Keep this only as a backup. It bypasses the client n8n workflow and sends bookings straight into Fix Your Leads.
            </div>
            <CopyableUrlField
              id="telnyx-direct-fallback-url"
              label="Fallback URL"
              defaultValue={directVoiceWebhookTarget}
              fallbackCopyValue={directVoiceWebhookTarget}
              copyButtonLabel="Copy URL"
              readOnly
            />
          </section>
          <section className="panel panel-dark panel-stack">
            <div className="metric-label">What happens on a live call</div>
            <div className="text-muted">
              The assistant gathers caller details, uses this tool, sends the body to the URL above, and then the client
              workflow or direct webhook creates the booking in Fix Your Leads.
            </div>
          </section>
        </div>
      </section>
    </LayoutShell>
  );
}
