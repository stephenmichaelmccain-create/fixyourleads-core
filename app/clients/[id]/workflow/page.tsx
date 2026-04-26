import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { CopyableCodeBlock } from '@/app/clients/[id]/workflow/CopyableCodeBlock';
import { CopyableUrlField } from '@/app/clients/[id]/workflow/CopyableUrlField';
import { LayoutShell } from '@/app/components/LayoutShell';
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

export default async function ClientWorkflowPage({
  params
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

  const voiceState = latestVoiceSetupEvent
    ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload)
    : emptyTelnyxSetupState;

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
            <div className="telnyx-setup-meta">
              <div className="key-value-card">
                <span className="key-value-label">Required</span>
                phone, startTime
              </div>
              <div className="key-value-card">
                <span className="key-value-label">Client routing</span>
                companyId, calledNumber
              </div>
              <div className="key-value-card">
                <span className="key-value-label">Optional routing</span>
                telnyxAssistantId
              </div>
            </div>
            <div className="telnyx-editor-two-up">
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
                placeholder="Save a client voice line first"
                fallbackCopyValue={voiceState.phoneNumber || ''}
                copyButtonLabel="Copy"
                readOnly
              />
            </div>
            <CopyableUrlField
              id="telnyx-assistant-id"
              label="telnyxAssistantId"
              defaultValue={company.telnyxAssistantId || ''}
              placeholder="Optional"
              fallbackCopyValue={company.telnyxAssistantId || ''}
              copyButtonLabel="Copy"
              readOnly
            />
            <CopyableCodeBlock label="Starter JSON body" value={voiceWebhookExamplePayload} copyButtonLabel="Copy JSON" />
          </div>
        </div>
      </section>
    </LayoutShell>
  );
}
