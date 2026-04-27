import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { retryClientAutomationAction } from '@/app/clients/[id]/workflow/actions';
import { LayoutShell } from '@/app/components/LayoutShell';
import { emptyClientAutomationState, parseClientAutomationPayload } from '@/lib/client-automation';
import { db } from '@/lib/db';
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

export default async function ClientN8nPage({
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
          name: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const latestAutomationEvent = await safeLoad(
    () =>
      db.eventLog.findFirst({
        where: { companyId: id, eventType: 'client_automation_updated' },
        orderBy: { createdAt: 'desc' },
        select: { payload: true }
      }),
    null
  );

  const automationState = latestAutomationEvent
    ? parseClientAutomationPayload(latestAutomationEvent.payload)
    : emptyClientAutomationState;
  const automationPresentation = automationStatusPresentation(automationState.status);

  return (
    <LayoutShell
      title={`${company.name} · n8n`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="n8n" />

      {query.notice ? (
        <section className="panel panel-stack" style={{ marginBottom: 20 }}>
          <div className="metric-label">Automation update</div>
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            {query.notice === 'updated'
              ? 'Automation settings saved.'
              : query.notice === 'automation_ready'
                ? 'n8n automation is live.'
                : query.notice === 'automation_attention'
                  ? 'n8n automation needs one more check.'
                  : 'n8n automation setup failed.'}
          </h2>
          <div className="text-muted">
            {query.notice === 'updated'
              ? 'The latest webhook and booking settings were saved, and provisioning re-ran in the background.'
              : query.notice === 'automation_ready'
                ? 'The shared n8n workflow cloned successfully and is ready for provider-specific tuning.'
                : query.notice === 'automation_attention'
                  ? automationState.lastError || 'Provisioning ran, but something still needs a manual check in n8n or Railway.'
                  : automationState.lastError || 'Provisioning failed. Review the error below and retry after fixing the blocker.'}
          </div>
        </section>
      ) : null}

      <section className="panel panel-stack telnyx-page-panel">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Automation</div>
            <h3 className="section-title">Shared n8n provisioning</h3>
            <div className="record-subtitle">
              Each client now gets one dedicated n8n workflow so booking-system glue can live in a visual editor instead of
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
            <div className="metric-copy">
              {automationState.workflowWebhookUrl || 'A unique production webhook URL will appear here after provisioning.'}
            </div>
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
              <span className={`status-dot ${automationState.workflowWebhookUrl ? 'ok' : 'warn'}`} />
              Production webhook
            </span>
            <span className="text-muted">
              {automationState.workflowWebhookUrl || 'Provision the client once to generate the live webhook for this workspace.'}
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
    </LayoutShell>
  );
}
