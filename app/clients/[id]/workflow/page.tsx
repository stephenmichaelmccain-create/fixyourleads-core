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
  const automationPresentation = automationStatusPresentation(automationState.status);

  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || null;
  const voiceWebhookSecret =
    process.env.VOICE_BOOKING_WEBHOOK_SECRET?.trim() ||
    process.env.VOICE_DEMO_WEBHOOK_SECRET?.trim() ||
    process.env.INTERNAL_API_KEY?.trim() ||
    '';
  const voiceWebhookTarget = voiceState.webhookUrl || (appBaseUrl ? `${appBaseUrl}/api/webhooks/voice/appointments` : '');
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

  return (
    <LayoutShell
      title={`${company.name} · Telnyx`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="workflow" />

      {query.notice ? (
        <section className="panel panel-stack" style={{ marginBottom: 20 }}>
          <div className="metric-label">Workflow update</div>
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            {query.notice === 'updated'
              ? 'Workflow settings saved.'
              : query.notice === 'automation_ready'
                ? 'Automation is live in n8n.'
                : query.notice === 'automation_attention'
                  ? 'Automation needs one more check.'
                  : 'Automation setup failed.'}
          </h2>
          <div className="text-muted">
            {query.notice === 'updated'
              ? 'The latest webhook and booking settings were saved, and automation provisioning was re-run in the background.'
              : query.notice === 'automation_ready'
                ? 'The shared n8n workflow cloned successfully and should be ready for provider-specific tuning.'
                : query.notice === 'automation_attention'
                  ? automationState.lastError || 'Provisioning ran, but something still needs a manual check in n8n or Railway.'
                  : automationState.lastError || 'Provisioning failed. Review the error below and retry after fixing the blocker.'}
          </div>
        </section>
      ) : null}

      <section className="panel panel-stack telnyx-page-panel" style={{ marginBottom: 20 }}>
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Automation</div>
            <h3 className="section-title">Shared n8n provisioning</h3>
            <div className="record-subtitle">
              Approval now provisions one shared n8n client workflow so booking-system glue can live in a visual editor instead of
              custom app code.
            </div>
          </div>
          <span className={automationPresentation.toneClass}>
            <span className={`status-dot ${automationPresentation.dot}`} />
            {automationPresentation.label}
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
            <div className="metric-label">Webhook path</div>
            <div className="metric-value" style={{ fontSize: '1rem' }}>
              {automationState.workflowWebhookPath || '—'}
            </div>
            <div className="metric-copy">{automationState.workflowWebhookUrl || 'A unique production webhook URL will appear here after provisioning.'}</div>
          </section>
          <section className="metric-card panel-stack">
            <div className="metric-label">Last sync</div>
            <div className="metric-value" style={{ fontSize: '1rem' }}>
              {automationState.updatedAt ? new Date(automationState.updatedAt).toLocaleString() : '—'}
            </div>
            <div className="metric-copy">{automationState.notes || 'No automation notes yet.'}</div>
          </section>
        </div>

        <div className="status-list">
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${automationState.workflowActive ? 'ok' : 'warn'}`} />
              Activation
            </span>
            <span className="text-muted">
              {automationState.workflowActive ? 'Workflow is marked active in n8n.' : 'Workflow is not active yet or still needs a manual check.'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${automationState.configUrl ? 'ok' : 'warn'}`} />
              Client config endpoint
            </span>
            <span className="text-muted">
              {automationState.configUrl || 'APP_BASE_URL and AUTOMATION_SHARED_SECRET are required before the workflow can fetch client config.'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${automationState.bookingCreateUrl ? 'ok' : 'warn'}`} />
              Booking writeback
            </span>
            <span className="text-muted">
              {automationState.bookingCreateUrl || 'INTERNAL_API_KEY and APP_BASE_URL are required so n8n can call back into booking creation.'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">
              <span className={`status-dot ${voiceWebhookTarget ? 'ok' : 'warn'}`} />
              Voice booking endpoint
            </span>
            <span className="text-muted">
              {voiceWebhookTarget || 'APP_BASE_URL is required so n8n can post finalized booking payloads back into the app.'}
            </span>
          </div>
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

      <section className="panel panel-stack telnyx-page-panel">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Telnyx</div>
            <h3 className="section-title">Edit Webhook Tool</h3>
            <div className="record-subtitle">
              This page mirrors the Telnyx webhook editor so someone can copy each field straight into the client&apos;s tool.
            </div>
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
            {!voiceWebhookSecret && (
              <div className="text-muted">
                No shared webhook secret is configured yet. Add `VOICE_BOOKING_WEBHOOK_SECRET` in Railway, or the app will use
                `INTERNAL_API_KEY` once that exists.
              </div>
            )}
          </div>

          <div className="telnyx-editor-section">
            <div className="metric-label">Body Parameters</div>
            <CopyableCodeBlock label="Body parameter schema" value={telnyxBodyParameterSchema} copyButtonLabel="Copy JSON" />
            <CopyableCodeBlock label="Example request body" value={voiceWebhookExamplePayload} copyButtonLabel="Copy example" />
          </div>
        </div>
      </section>
    </LayoutShell>
  );
}
