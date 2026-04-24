import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { saveClientTelnyxSetupAction } from '@/app/clients/[id]/telnyx/actions';
import { db } from '@/lib/db';
import {
  emptyTelnyxSetupState,
  parseTelnyxSetupPayload,
  telnyxChecklistOrder,
  telnyxSetupProgress
} from '@/lib/client-telnyx-setup';
import { allInboundNumbers, companyPrimaryInboundNumber } from '@/lib/inbound-numbers';
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
          primaryContactPhone: true,
          telnyxInboundNumber: true,
          createdAt: true,
          telnyxInboundNumbers: {
            select: { number: true },
            orderBy: { createdAt: 'asc' }
          }
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
  const progress = telnyxSetupProgress(state);
  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || null;
  const defaultWebhookUrl = appBaseUrl ? `${appBaseUrl}/api/webhooks/telnyx` : '';
  const assignedNumbers = allInboundNumbers(company);
  const routingMode = companyPrimaryInboundNumber(company) ? 'Dedicated' : assignedNumbers.length ? 'Shared plus assigned lines' : 'Unassigned';
  const businessEmail = state.businessEmail || company.notificationEmail || '';
  const businessPhone = state.businessPhone || company.primaryContactPhone || '';
  const businessWebsite = state.website || company.website || '';

  return (
    <LayoutShell
      title={`${company.name} · Telnyx Setup`}
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
            <strong>Telnyx setup saved.</strong>
          </div>
          <div className="text-muted">The onboarding checklist, IDs, and notes are now stored on this client.</div>
        </section>
      )}

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Telnyx setup</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              Follow the exact client onboarding sequence here: collect intake, register 10DLC, create the messaging profile, assign the number, point Telnyx at Fix Your Leads, test it, then document everything.
            </div>
            <div className="inline-row client-record-chip-row">
              <span className={`readiness-pill ${progress.completed === progress.total ? 'is-ready' : 'is-warn'}`}>
                {progress.completed}/{progress.total} complete
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Routing</strong> {routingMode}
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Webhook</strong> {state.webhookConfigured ? 'Configured' : 'Pending'}
              </span>
            </div>
          </div>
          <div className="workspace-action-rail">
            <a className="button" href={`/clients/${company.id}/operator?lab=sms`}>
              Run Comms Lab test
            </a>
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              View events
            </a>
          </div>
        </div>

        <div className="client-record-stats">
          <div className="client-record-stat">
            <span className="metric-label">Assigned lines</span>
            <strong className="workspace-stats-value">{assignedNumbers.length}</strong>
            <span className="tiny-muted">{assignedNumbers[0] || 'No numbers assigned yet'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Webhook target</span>
            <strong className="workspace-stats-value">{state.webhookUrl ? 'Saved' : appBaseUrl ? 'Ready' : 'Missing env'}</strong>
            <span className="tiny-muted">{state.webhookUrl || defaultWebhookUrl || 'APP_BASE_URL missing'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Campaign</span>
            <strong className="workspace-stats-value">{state.campaignStatus || 'Pending'}</strong>
            <span className="tiny-muted">{state.campaignId || 'No campaign ID yet'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Last saved</span>
            <strong className="workspace-stats-value">{formatCompactDateTime(state.updatedAt || latestSetupEvent?.createdAt)}</strong>
            <span className="tiny-muted">Stored in the client event log so it deploys safely.</span>
          </div>
        </div>
      </section>

      <div className="client-record-layout">
        <div className="panel-stack">
          <section className="panel panel-stack">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Checklist</div>
                <h3 className="section-title">Move each client to launch</h3>
                <div className="record-subtitle">
                  This is the exact operational flow you described, now tracked in the app so each client has a visible setup state.
                </div>
              </div>
            </div>

            <form action={saveClientTelnyxSetupAction} className="panel-stack client-profile-form">
              <input type="hidden" name="companyId" value={company.id} />

              <div className="client-profile-section">
                <div className="metric-label">Progress checklist</div>
                <div className="telnyx-checklist-grid">
                  {telnyxChecklistOrder.map((item) => (
                    <label key={item.key} className="telnyx-checklist-item">
                      <input type="checkbox" name={item.key} defaultChecked={state[item.key]} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">1. Client intake</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-legal-business-name">
                      Legal business name
                    </label>
                    <input
                      id="telnyx-legal-business-name"
                      className="text-input"
                      name="legalBusinessName"
                      defaultValue={state.legalBusinessName || company.name}
                      placeholder="Glow Med Spa LLC"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-ein">
                      EIN
                    </label>
                    <input
                      id="telnyx-ein"
                      className="text-input"
                      name="ein"
                      defaultValue={state.ein || ''}
                      placeholder="12-3456789"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-monthly-volume">
                      Est. monthly volume
                    </label>
                    <input
                      id="telnyx-monthly-volume"
                      className="text-input"
                      name="monthlyVolume"
                      defaultValue={state.monthlyVolume || ''}
                      placeholder="500"
                    />
                  </div>
                </div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-business-address">
                      Business address
                    </label>
                    <input
                      id="telnyx-business-address"
                      className="text-input"
                      name="businessAddress"
                      defaultValue={state.businessAddress || ''}
                      placeholder="123 Main St, City, ST 00000"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-business-email">
                      Business email
                    </label>
                    <input
                      id="telnyx-business-email"
                      className="text-input"
                      name="businessEmail"
                      defaultValue={businessEmail}
                      placeholder="hello@business.com"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-business-phone">
                      Business phone
                    </label>
                    <input
                      id="telnyx-business-phone"
                      className="text-input"
                      name="businessPhone"
                      defaultValue={businessPhone}
                      placeholder="+13035551234"
                    />
                  </div>
                </div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-website">
                      Website
                    </label>
                    <input
                      id="telnyx-website"
                      className="text-input"
                      name="website"
                      defaultValue={businessWebsite}
                      placeholder="https://business.com"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-intake-form-url">
                      Intake form link
                    </label>
                    <input
                      id="telnyx-intake-form-url"
                      className="text-input"
                      name="intakeFormUrl"
                      defaultValue={state.intakeFormUrl || ''}
                      placeholder="https://forms.gle/... or internal intake doc"
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">2. 10DLC brand and campaign</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-brand-id">
                      Brand ID
                    </label>
                    <input id="telnyx-brand-id" className="text-input" name="brandId" defaultValue={state.brandId || ''} />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-brand-status">
                      Brand status
                    </label>
                    <input
                      id="telnyx-brand-status"
                      className="text-input"
                      name="brandStatus"
                      defaultValue={state.brandStatus || ''}
                      placeholder="Verified"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-campaign-id">
                      Campaign ID
                    </label>
                    <input id="telnyx-campaign-id" className="text-input" name="campaignId" defaultValue={state.campaignId || ''} />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-campaign-status">
                      Campaign status
                    </label>
                    <input
                      id="telnyx-campaign-status"
                      className="text-input"
                      name="campaignStatus"
                      defaultValue={state.campaignStatus || ''}
                      placeholder="Approved"
                    />
                  </div>
                </div>

                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-campaign-use-case">
                      Campaign use case
                    </label>
                    <input
                      id="telnyx-campaign-use-case"
                      className="text-input"
                      value="Customer Care"
                      readOnly
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">3. Messaging profile and number</div>
                <div className="record-subtitle">
                  Create the messaging profile, attach the approved campaign, then buy or port the client number and assign it here.
                </div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-profile-id">
                      Messaging profile ID
                    </label>
                    <input
                      id="telnyx-profile-id"
                      className="text-input"
                      name="messagingProfileId"
                      defaultValue={state.messagingProfileId || ''}
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-profile-status">
                      Messaging profile status
                    </label>
                    <input
                      id="telnyx-profile-status"
                      className="text-input"
                      name="messagingProfileStatus"
                      defaultValue={state.messagingProfileStatus || ''}
                      placeholder="Linked to approved campaign"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-phone-number">
                      Client number
                    </label>
                    <input
                      id="telnyx-phone-number"
                      className="text-input"
                      name="phoneNumber"
                      defaultValue={state.phoneNumber || assignedNumbers[0] || ''}
                      placeholder="+17205550199"
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">4. Webhook and routing</div>
                <div className="record-subtitle">
                  Point the Telnyx messaging profile to Fix Your Leads first. Use an automation link only if you intentionally add Make or another downstream tool after the app.
                </div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="telnyx-webhook-url">
                    Webhook URL
                  </label>
                  <input
                    id="telnyx-webhook-url"
                    className="text-input"
                    name="webhookUrl"
                    defaultValue={state.webhookUrl || defaultWebhookUrl}
                    placeholder="https://app-production-9ba1.up.railway.app/api/webhooks/telnyx"
                  />
                </div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-automation-url">
                      Automation link
                    </label>
                    <input
                      id="telnyx-automation-url"
                      className="text-input"
                      name="automationUrl"
                      defaultValue={state.automationUrl || ''}
                      placeholder="https://www.make.com/... or internal workflow link"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="telnyx-documentation-url">
                      Documentation URL
                    </label>
                    <input
                      id="telnyx-documentation-url"
                      className="text-input"
                      name="documentationUrl"
                      defaultValue={state.documentationUrl || ''}
                      placeholder="https://docs.google.com/..."
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">5. Compliance and sample messaging</div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="telnyx-sample-message">
                    Sample message
                  </label>
                  <textarea
                    id="telnyx-sample-message"
                    className="text-area"
                    name="sampleMessage"
                    defaultValue={state.sampleMessage || ''}
                    placeholder="Hi Sarah, this is Glow Med Spa. Thanks for your inquiry. Reply STOP to opt out."
                    rows={3}
                  />
                </div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="telnyx-compliance-notes">
                    Compliance notes
                  </label>
                  <textarea
                    id="telnyx-compliance-notes"
                    className="text-area"
                    name="complianceNotes"
                    defaultValue={state.complianceNotes || ''}
                    placeholder="Opt-in collected at booking, first message includes STOP, quiet hours handled in app."
                    rows={3}
                  />
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">6. Documentation</div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="telnyx-notes">
                    Notes
                  </label>
                  <textarea
                    id="telnyx-notes"
                    className="text-area"
                    name="notes"
                    defaultValue={state.notes || ''}
                    placeholder="Port-in needed, campaign approved same day, quiet hours handled in app."
                    rows={4}
                  />
                </div>
              </div>

              <div className="inline-actions">
                <button type="submit" className="button">
                  Save Telnyx setup
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside className="client-record-sidebar">
          <section className="panel panel-stack">
            <div className="metric-label">Live routing</div>
            <div className="client-record-sidebar-grid">
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Assigned lines</span>
                <strong>{assignedNumbers.length}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Primary line</span>
                <strong>{companyPrimaryInboundNumber(company) || 'Shared fallback'}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Webhook</span>
                <strong>{state.webhookConfigured ? 'Configured' : 'Pending'}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Created</span>
                <strong>{formatCompactDateTime(company.createdAt)}</strong>
              </div>
            </div>
          </section>

          <section className="panel panel-stack">
            <div className="metric-label">Recent setup saves</div>
            <div className="workspace-list">
              {recentSetupEvents.length === 0 ? (
                <div className="workspace-list-item">
                  <span className="tiny-muted">No Telnyx setup save yet. Use this page to store the client onboarding record.</span>
                </div>
              ) : (
                recentSetupEvents.map((event, index) => {
                  const eventState = parseTelnyxSetupPayload(event.payload);
                  const eventProgress = telnyxSetupProgress(eventState);

                  return (
                    <div key={`${event.createdAt.toISOString()}-${index}`} className="workspace-list-item">
                      <div className="workspace-list-header">
                        <strong>{formatCompactDateTime(event.createdAt)}</strong>
                        <span className="tiny-muted">
                          {eventProgress.completed}/{eventProgress.total}
                        </span>
                      </div>
                      <span className="tiny-muted">
                        {eventState.campaignStatus || eventState.brandStatus || 'Saved progress'} • {eventState.phoneNumber || 'No number saved'}
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
