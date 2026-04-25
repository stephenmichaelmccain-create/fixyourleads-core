import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { saveClientTelnyxSetupAction } from '@/app/clients/[id]/telnyx/actions';
import { db } from '@/lib/db';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
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

export default async function ClientTelnyxSetupPage({
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
          website: true,
          notificationEmail: true,
          primaryContactName: true,
          primaryContactPhone: true,
          createdAt: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [latestSetupEvent, recentSetupEvents] = await Promise.all([
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
        db.eventLog.findMany({
          where: { companyId: id, eventType: 'client_telnyx_setup_updated' },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { createdAt: true, payload: true }
        }),
      []
    )
  ]);

  const state = latestSetupEvent ? parseTelnyxSetupPayload(latestSetupEvent.payload) : emptyTelnyxSetupState;
  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || null;
  const defaultWebhookUrl = appBaseUrl ? `${appBaseUrl}/api/webhooks/telnyx` : '';
  const voiceWebhookTarget = state.webhookUrl || defaultWebhookUrl || '';
  const webhookReady = Boolean(state.webhookConfigured || state.webhookUrl);
  const voiceLine = state.phoneNumber || company.primaryContactPhone || '';

  return (
    <LayoutShell
      title={`${company.name} · AI Voice`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="telnyx" />

      {query.notice === 'updated' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>AI voice setup saved.</strong>
          </div>
          <div className="text-muted">The webhook target and assistant notes are now stored on this client.</div>
        </section>
      )}

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">AI voice webhook</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              This page is only for the AI voice hookup now. Save the webhook target, optional voice line, and any provider
              notes your team needs when connecting the assistant.
            </div>
            <div className="inline-row client-record-chip-row">
              <span className={`readiness-pill ${webhookReady ? 'is-ready' : 'is-warn'}`}>
                {webhookReady ? 'Webhook ready' : 'Webhook pending'}
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Last saved</strong> {formatCompactDateTime(state.updatedAt || latestSetupEvent?.createdAt)}
              </span>
            </div>
          </div>
          <div className="workspace-action-rail">
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              View events
            </a>
            <a className="button-secondary" href={`/clients/${company.id}`}>
              Back to profile
            </a>
          </div>
        </div>

        <div className="client-record-stats">
          <div className="client-record-stat">
            <span className="metric-label">Webhook target</span>
            <strong className="workspace-stats-value">{voiceWebhookTarget || 'Missing'}</strong>
            <span className="tiny-muted">Use this endpoint in the AI voice provider.</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Voice line</span>
            <strong className="workspace-stats-value">{voiceLine || 'Not saved yet'}</strong>
            <span className="tiny-muted">Optional, if the provider assigns a phone number or DID.</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Provider notes</span>
            <strong className="workspace-stats-value">{state.documentationUrl ? 'Linked' : 'Not linked'}</strong>
            <span className="tiny-muted">{state.documentationUrl || 'Save the provider dashboard or setup doc URL here.'}</span>
          </div>
        </div>
      </section>

      <div className="client-record-layout">
        <div className="panel-stack">
          <section className="panel panel-stack">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Connection</div>
                <h3 className="section-title">Store the webhook hookup</h3>
                <div className="record-subtitle">
                  Keep only the fields that matter for the AI voice handoff. Everything old messaging/carrier related is out
                  of the way now.
                </div>
              </div>
            </div>

            <form action={saveClientTelnyxSetupAction} className="panel-stack client-profile-form">
              <input type="hidden" name="companyId" value={company.id} />

              <div className="client-profile-section">
                <div className="metric-label">Client context</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="voice-legal-business-name">
                      Business name
                    </label>
                    <input
                      id="voice-legal-business-name"
                      className="text-input"
                      name="legalBusinessName"
                      defaultValue={state.legalBusinessName || company.name}
                      placeholder="Ripple Strategies"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="voice-business-email">
                      Business email
                    </label>
                    <input
                      id="voice-business-email"
                      className="text-input"
                      name="businessEmail"
                      defaultValue={state.businessEmail || company.notificationEmail || ''}
                      placeholder="hello@client.com"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="voice-website">
                      Website
                    </label>
                    <input
                      id="voice-website"
                      className="text-input"
                      name="website"
                      defaultValue={state.website || company.website || ''}
                      placeholder="https://client.com"
                    />
                  </div>
                </div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="voice-business-phone">
                      Main business phone
                    </label>
                    <input
                      id="voice-business-phone"
                      className="text-input"
                      name="businessPhone"
                      defaultValue={state.businessPhone || company.primaryContactPhone || ''}
                      placeholder="+13035551234"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="voice-line">
                      AI voice line
                    </label>
                    <input
                      id="voice-line"
                      className="text-input"
                      name="phoneNumber"
                      defaultValue={voiceLine}
                      placeholder="+13035550199"
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Webhook setup</div>
                <div className="telnyx-checklist-grid">
                  <label className="telnyx-checklist-item">
                    <input type="checkbox" name="clientInfoCollected" defaultChecked={state.clientInfoCollected} />
                    <span>Client details confirmed</span>
                  </label>
                  <label className="telnyx-checklist-item">
                    <input type="checkbox" name="webhookConfigured" defaultChecked={state.webhookConfigured} />
                    <span>Webhook configured in provider</span>
                  </label>
                  <label className="telnyx-checklist-item">
                    <input type="checkbox" name="launchApproved" defaultChecked={state.launchApproved} />
                    <span>Ready for launch</span>
                  </label>
                </div>

                <div className="field-stack">
                  <label className="key-value-label" htmlFor="voice-webhook-url">
                    Webhook URL
                  </label>
                  <input
                    id="voice-webhook-url"
                    className="text-input"
                    name="webhookUrl"
                    defaultValue={voiceWebhookTarget}
                    placeholder="https://app-production-9ba1.up.railway.app/api/webhooks/telnyx"
                  />
                  <span className="tiny-muted">This is the only required hookup if the AI voice provider just needs a webhook target.</span>
                </div>

                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="voice-automation-url">
                      Forwarding or workflow URL
                    </label>
                    <input
                      id="voice-automation-url"
                      className="text-input"
                      name="automationUrl"
                      defaultValue={state.automationUrl || ''}
                      placeholder="Optional internal automation link"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="voice-documentation-url">
                      Provider dashboard or doc URL
                    </label>
                    <input
                      id="voice-documentation-url"
                      className="text-input"
                      name="documentationUrl"
                      defaultValue={state.documentationUrl || ''}
                      placeholder="https://provider.example.com/..."
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Notes</div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="voice-notes">
                    Setup notes
                  </label>
                  <textarea
                    id="voice-notes"
                    className="text-area"
                    name="notes"
                    defaultValue={state.notes || ''}
                    placeholder="Webhook tested, provider account owner, install reminders, or anything the next operator should know."
                    rows={5}
                  />
                </div>
              </div>

              <div className="inline-actions">
                <button type="submit" className="button">
                  Save AI voice setup
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside className="client-record-sidebar">
          <section className="panel panel-stack">
            <div className="metric-label">Webhook snapshot</div>
            <div className="client-record-sidebar-grid">
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Created</span>
                <strong>{formatCompactDateTime(company.createdAt)}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Webhook status</span>
                <strong>{webhookReady ? 'Configured' : 'Pending'}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Webhook target</span>
                <strong>{voiceWebhookTarget || 'Missing'}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Voice line</span>
                <strong>{voiceLine || 'Not saved yet'}</strong>
              </div>
            </div>
          </section>

          <section className="panel panel-stack">
            <div className="metric-label">Recent setup saves</div>
            <div className="workspace-list">
              {recentSetupEvents.length === 0 ? (
                <div className="workspace-list-item">
                  <span className="tiny-muted">No AI voice setup save yet. Use this page to store the webhook hookup for this client.</span>
                </div>
              ) : (
                recentSetupEvents.map((event, index) => {
                  const eventState = parseTelnyxSetupPayload(event.payload);

                  return (
                    <div key={`${event.createdAt.toISOString()}-${index}`} className="workspace-list-item">
                      <div className="workspace-list-header">
                        <strong>{formatCompactDateTime(event.createdAt)}</strong>
                        <span className="tiny-muted">{eventState.webhookConfigured ? 'Configured' : 'Saved draft'}</span>
                      </div>
                      <span className="tiny-muted">
                        {eventState.webhookUrl || 'No webhook URL saved'} • {eventState.phoneNumber || 'No voice line saved'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </LayoutShell>
  );
}
