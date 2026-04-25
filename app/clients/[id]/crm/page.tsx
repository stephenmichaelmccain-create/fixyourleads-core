import { notFound } from 'next/navigation';
import { CrmProvider } from '@prisma/client';
import {
  saveClientCrmIntegrationAction,
  testClientCrmIntegrationAction
} from '@/app/clients/[id]/crm/actions';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
  test?: string;
  provider?: string;
  detail?: string;
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

function providerLabel(provider: CrmProvider) {
  const labels: Record<CrmProvider, string> = {
    NONE: 'None',
    HUBSPOT: 'HubSpot',
    PIPEDRIVE: 'Pipedrive',
    GOHIGHLEVEL: 'GoHighLevel',
    SALESFORCE: 'Salesforce',
    BOULEVARD: 'Boulevard',
    VAGARO: 'Vagaro'
  };

  return labels[provider];
}

function prettyJson(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '{\n  "full_name": "",\n  "email": "",\n  "phone": "",\n  "business_name": ""\n}';
  }

  return JSON.stringify(value, null, 2);
}

export default async function ClientCrmPage({
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
          crmCredentialsEncrypted: true,
          crmFieldMapping: true,
          telnyxAssistantId: true,
          notificationEmail: true,
          notificationPhone: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [contacts, leads, conversations, appointments, crmSyncLogs] = await Promise.all([
    safeLoad(
      () =>
        db.contact.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            createdAt: true,
            _count: {
              select: {
                leads: true,
                conversations: true,
                appointments: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.lead.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            status: true,
            source: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.conversation.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                content: true,
                createdAt: true,
                direction: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.appointment.findMany({
          where: { companyId: id },
          orderBy: { startTime: 'desc' },
          take: 25,
          select: {
            id: true,
            startTime: true,
            status: true,
            createdAt: true,
            contact: {
              select: {
                name: true,
                phone: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.crmSyncLog.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            provider: true,
            status: true,
            externalId: true,
            error: true,
            attempt: true,
            createdAt: true
          }
        }),
      []
    )
  ]);

  return (
    <LayoutShell
      title={`${company.name} · CRM`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="crm" />

      {query.notice === 'crm_updated' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>CRM integration saved.</strong>
          </div>
          <div className="text-muted">Voice leads will now use this provider config after they are saved locally.</div>
        </section>
      )}

      {query.notice === 'invalid_credentials' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot error" />
            <strong>Credentials must be valid JSON.</strong>
          </div>
        </section>
      )}

      {query.notice === 'invalid_field_mapping' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot error" />
            <strong>Field mapping must be valid JSON.</strong>
          </div>
        </section>
      )}

      {query.notice === 'encryption_key_missing' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot error" />
            <strong>CRM encryption key missing.</strong>
          </div>
          <div className="text-muted">Set CRM_CREDENTIAL_ENCRYPTION_KEY before saving provider credentials.</div>
        </section>
      )}

      {query.test && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${query.test === 'success' ? 'ok' : 'error'}`} />
            <strong>CRM test {query.test === 'success' ? 'worked' : 'failed'}.</strong>
          </div>
          <div className="text-muted">
            {query.provider ? `${query.provider}: ` : ''}
            {query.detail || 'No detail returned'}
          </div>
        </section>
      )}

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">CRM workspace</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              This is the collected-records view for this client: contacts, leads, conversations, and bookings already in Fix Your Leads.
            </div>
          </div>
          <div className="workspace-action-rail">
            <a className="button" href={`/clients/${company.id}/operator`}>
              Open operator workspace
            </a>
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              View events
            </a>
          </div>
        </div>

        <div className="client-record-stats">
          <div className="client-record-stat">
            <span className="metric-label">Contacts</span>
            <strong className="workspace-stats-value">{contacts.length}</strong>
            <span className="tiny-muted">Most recent people collected for this client</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Leads</span>
            <strong className="workspace-stats-value">{leads.length}</strong>
            <span className="tiny-muted">Latest lead records in this workspace</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Conversations</span>
            <strong className="workspace-stats-value">{conversations.length}</strong>
            <span className="tiny-muted">Recent messaging threads</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Bookings</span>
            <strong className="workspace-stats-value">{appointments.length}</strong>
            <span className="tiny-muted">Recent appointment records</span>
          </div>
        </div>
      </section>

      <div className="panel-stack">
        <section className="panel panel-stack" id="crm-integration">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">CRM Integration</div>
              <h3 className="section-title">Push voice leads into their existing CRM</h3>
              <div className="record-subtitle">
                Fix Your Leads stays the source of truth first. This adapter sends the same lead into HubSpot,
                GoHighLevel, or a no-op log depending on the client.
              </div>
            </div>
            <div className="workspace-action-rail">
              <form action={testClientCrmIntegrationAction}>
                <input type="hidden" name="companyId" value={company.id} />
                <button type="submit" className="button-secondary">
                  Test CRM push
                </button>
              </form>
            </div>
          </div>

          <div className="client-record-inline-stats">
            <span className="status-chip status-chip-muted">
              <strong>Provider</strong> {providerLabel(company.crmProvider)}
            </span>
            <span className={`status-chip ${company.crmCredentialsEncrypted ? '' : 'status-chip-muted'}`}>
              <strong>Credentials</strong> {company.crmProvider === CrmProvider.NONE ? 'Not needed' : company.crmCredentialsEncrypted ? 'Saved encrypted' : 'Missing'}
            </span>
            <span className="status-chip status-chip-muted">
              <strong>Assistant</strong> {company.telnyxAssistantId || 'Fallback routing'}
            </span>
          </div>

          <form action={saveClientCrmIntegrationAction} className="panel-stack client-profile-form">
            <input type="hidden" name="companyId" value={company.id} />

            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="crm-provider">
                  CRM provider
                </label>
                <select id="crm-provider" className="text-input" name="crmProvider" defaultValue={company.crmProvider}>
                  {Object.values(CrmProvider).map((provider) => (
                    <option key={provider} value={provider}>
                      {providerLabel(provider)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="telnyx-assistant-id">
                  Telnyx assistant ID
                </label>
                <input
                  id="telnyx-assistant-id"
                  className="text-input"
                  name="telnyxAssistantId"
                  defaultValue={company.telnyxAssistantId || ''}
                  placeholder="assistant_xxx"
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="notification-phone">
                  Owner alert phone
                </label>
                <input
                  id="notification-phone"
                  className="text-input"
                  name="notificationPhone"
                  defaultValue={company.notificationPhone || ''}
                  placeholder="+13035550123"
                />
              </div>
            </div>

            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="crm-credentials">
                  Credentials JSON
                </label>
                <textarea
                  id="crm-credentials"
                  className="text-area"
                  name="crmCredentials"
                  rows={7}
                  placeholder={'HubSpot: {"privateAppToken":"pat-..."}\nGoHighLevel: {"accessToken":"...","locationId":"..."}\nLeave blank to keep saved credentials.'}
                />
                <span className="tiny-muted">
                  Credentials are encrypted before storage and never printed back on this page.
                </span>
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="crm-field-mapping">
                  Field mapping JSON
                </label>
                <textarea
                  id="crm-field-mapping"
                  className="text-area"
                  name="crmFieldMapping"
                  rows={7}
                  defaultValue={prettyJson(company.crmFieldMapping)}
                />
                <span className="tiny-muted">
                  Optional. Example: map <code>business_name</code> to a custom CRM field.
                </span>
              </div>
            </div>

            <div className="inline-actions">
              <button type="submit" className="button">
                Save CRM integration
              </button>
            </div>
          </form>
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">CRM sync log</div>
              <h3 className="section-title">Last pushes</h3>
            </div>
          </div>
          {crmSyncLogs.length === 0 ? (
            <div className="empty-state">No CRM sync attempts yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Status</th>
                    <th>External ID</th>
                    <th>Attempt</th>
                    <th>Detail</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {crmSyncLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{providerLabel(log.provider)}</td>
                      <td>{log.status}</td>
                      <td>{log.externalId || '—'}</td>
                      <td>{log.attempt}</td>
                      <td>{log.error || '—'}</td>
                      <td>{formatCompactDateTime(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Contacts</div>
              <h3 className="section-title">People we have collected</h3>
            </div>
          </div>
          {contacts.length === 0 ? (
            <div className="empty-state">No contacts collected yet for this client.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Activity</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr key={contact.id}>
                      <td>{contact.name || 'Unnamed contact'}</td>
                      <td>{contact.phone}</td>
                      <td>{contact.email || '—'}</td>
                      <td>
                        {contact._count.leads} leads • {contact._count.conversations} threads • {contact._count.appointments} bookings
                      </td>
                      <td>{formatCompactDateTime(contact.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Leads</div>
              <h3 className="section-title">Lead records</h3>
            </div>
          </div>
          {leads.length === 0 ? (
            <div className="empty-state">No leads collected yet for this client.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Phone</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.contact.name || 'Unnamed contact'}</td>
                      <td>{lead.contact.phone || '—'}</td>
                      <td>{lead.source || 'Manual / unknown'}</td>
                      <td>{lead.status}</td>
                      <td>{formatCompactDateTime(lead.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Conversations</div>
              <h3 className="section-title">Recent threads</h3>
            </div>
          </div>
          {conversations.length === 0 ? (
            <div className="empty-state">No conversations yet for this client.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Last message</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conversation) => (
                    <tr key={conversation.id}>
                      <td>{conversation.contact.name || 'Unnamed contact'}</td>
                      <td>{conversation.contact.phone || '—'}</td>
                      <td>{conversation.messages[0] ? `${conversation.messages[0].direction}: ${conversation.messages[0].content.slice(0, 90)}` : 'No messages yet'}</td>
                      <td>{formatCompactDateTime(conversation.messages[0]?.createdAt || conversation.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Bookings</div>
              <h3 className="section-title">Appointment records</h3>
            </div>
          </div>
          {appointments.length === 0 ? (
            <div className="empty-state">No bookings yet for this client.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((appointment) => (
                    <tr key={appointment.id}>
                      <td>{appointment.contact.name || 'Unnamed contact'}</td>
                      <td>{appointment.contact.phone || '—'}</td>
                      <td>{formatCompactDateTime(appointment.startTime)}</td>
                      <td>{appointment.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </LayoutShell>
  );
}
