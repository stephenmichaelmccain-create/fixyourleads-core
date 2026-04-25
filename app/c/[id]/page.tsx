import { CrmProvider } from '@prisma/client';
import { notFound } from 'next/navigation';
import { saveClientPortalSetupAction } from '@/app/c/[id]/actions';
import { db } from '@/lib/db';
import { isValidClientViewToken } from '@/lib/client-view-auth';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  token?: string;
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

function providerLabel(provider: CrmProvider) {
  const labels: Record<CrmProvider, string> = {
    NONE: 'Not connected',
    HUBSPOT: 'HubSpot',
    PIPEDRIVE: 'Pipedrive',
    GOHIGHLEVEL: 'GoHighLevel',
    SALESFORCE: 'Salesforce',
    BOULEVARD: 'Boulevard',
    VAGARO: 'Vagaro'
  };

  return labels[provider];
}

function readPayloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

function portalStatus(options: {
  hasPrimaryContact: boolean;
  crmReady: boolean;
  bookingReady: boolean;
}) {
  if (options.hasPrimaryContact && (options.crmReady || options.bookingReady)) {
    return {
      label: 'Setup ready',
      tone: 'ready' as const,
      detail: 'Your core details are saved and at least one integration is connected.'
    };
  }

  return {
    label: 'Setup in progress',
    tone: 'pending' as const,
    detail: 'Add your business details and at least one integration so we can finish setup.'
  };
}

export default async function ClientStatusPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParamShape;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};
  const token = String(query.token || '').trim();

  if (!isValidClientViewToken(id, token)) {
    notFound();
  }

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          website: true,
          createdAt: true,
          notificationEmail: true,
          primaryContactName: true,
          primaryContactEmail: true,
          primaryContactPhone: true,
          crmProvider: true,
          crmCredentialsEncrypted: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const latestBookingSetupEvent = await safeLoad(
    () =>
      db.eventLog.findFirst({
        where: {
          companyId: id,
          eventType: 'client_calendar_setup_updated'
        },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          payload: true
        }
      }),
    null
  );

  const bookingPayload = readPayloadRecord(latestBookingSetupEvent?.payload);
  const bookingPlatformName = payloadString(bookingPayload, 'externalPlatformName');
  const bookingPlatformUrl = payloadString(bookingPayload, 'externalPlatformUrl');
  const bookingCredentialsSaved = Boolean(payloadString(bookingPayload, 'externalPlatformCredentialsEncrypted'));
  const crmCredentialsSaved = Boolean(company.crmCredentialsEncrypted);
  const hasPrimaryContact = Boolean(company.primaryContactName || company.primaryContactEmail || company.primaryContactPhone);
  const status = portalStatus({
    hasPrimaryContact,
    crmReady: crmCredentialsSaved,
    bookingReady: bookingCredentialsSaved || Boolean(bookingPlatformUrl)
  });

  return (
    <main className="app-shell client-public-shell">
      <section className="panel panel-stack client-status-page client-public-page">
        {query.notice === 'saved' && (
          <section className="panel panel-stack client-public-inline-notice">
            <div className="inline-row">
              <span className="status-dot ok" />
              <strong>Setup saved.</strong>
            </div>
            <div className="text-muted">
              Your business details and integration settings are updated. Saved API keys stay hidden after submission.
            </div>
          </section>
        )}

        {query.notice === 'encryption_key_missing' && (
          <section className="panel panel-stack client-public-inline-notice panel-attention">
            <div className="inline-row">
              <span className="status-dot warn" />
              <strong>Secure key storage is not ready yet.</strong>
            </div>
            <div className="text-muted">Please contact Fix Your Leads so we can finish the encrypted API key setup.</div>
          </section>
        )}

        {query.notice === 'credentials_invalid' && (
          <section className="panel panel-stack client-public-inline-notice panel-attention">
            <div className="inline-row">
              <span className="status-dot warn" />
              <strong>We could not save those API keys.</strong>
            </div>
            <div className="text-muted">Try again with fresh keys, or leave the key fields blank to keep the saved ones.</div>
          </section>
        )}

        {query.notice === 'name_required' && (
          <section className="panel panel-stack client-public-inline-notice panel-attention">
            <div className="inline-row">
              <span className="status-dot warn" />
              <strong>Business name is required.</strong>
            </div>
          </section>
        )}

        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Fix Your Leads</div>
            <h1 className="section-title">{company.name}</h1>
            <div className="record-subtitle">
              Use this page to keep your business information current and connect the CRM or booking system your workspace needs.
            </div>
          </div>
          <div className={`client-status-hero is-${status.tone}`}>
            <span className={`status-dot ${status.tone === 'ready' ? 'ok' : 'warn'}`} />
            <strong>{status.label}</strong>
            <span className="tiny-muted">{status.detail}</span>
          </div>
        </div>

        <div className="client-record-stats">
          <div className="client-record-stat">
            <span className="metric-label">Primary contact</span>
            <strong className="workspace-stats-value">{company.primaryContactName || 'Missing'}</strong>
            <span className="tiny-muted">{company.primaryContactEmail || company.primaryContactPhone || 'Add the best owner or manager contact.'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">CRM</span>
            <strong className="workspace-stats-value">{providerLabel(company.crmProvider)}</strong>
            <span className="tiny-muted">{crmCredentialsSaved ? 'API keys saved securely' : 'Provider not finished yet'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Booking</span>
            <strong className="workspace-stats-value">{bookingPlatformName || 'Not connected'}</strong>
            <span className="tiny-muted">{bookingCredentialsSaved ? 'API keys saved securely' : bookingPlatformUrl || 'Add the booking platform details here.'}</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Last setup save</span>
            <strong className="workspace-stats-value">{formatCompactDateTime(latestBookingSetupEvent?.createdAt || company.createdAt)}</strong>
            <span className="tiny-muted">We keep your latest setup details attached to this workspace.</span>
          </div>
        </div>

        <div className="client-record-layout">
          <section className="panel panel-stack">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Client setup</div>
                <h2 className="section-title">Update your workspace details</h2>
                <div className="record-subtitle">
                  You can update your business info here and add the CRM or booking API keys we need. Once keys are saved, they will not be shown again.
                </div>
              </div>
            </div>

            <form action={saveClientPortalSetupAction} className="panel-stack client-profile-form">
              <input type="hidden" name="companyId" value={company.id} />
              <input type="hidden" name="token" value={token} />

              <div className="client-profile-section">
                <div className="metric-label">Business details</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-name">
                      Business name
                    </label>
                    <input id="portal-name" className="text-input" name="name" defaultValue={company.name} />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-website">
                      Website
                    </label>
                    <input
                      id="portal-website"
                      className="text-input"
                      name="website"
                      defaultValue={company.website || ''}
                      placeholder="https://yourbusiness.com"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-notification-email">
                      Business email
                    </label>
                    <input
                      id="portal-notification-email"
                      className="text-input"
                      name="notificationEmail"
                      defaultValue={company.notificationEmail || ''}
                      placeholder="team@yourbusiness.com"
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Primary contact</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-contact-name">
                      Contact name
                    </label>
                    <input
                      id="portal-contact-name"
                      className="text-input"
                      name="primaryContactName"
                      defaultValue={company.primaryContactName || ''}
                      placeholder="Owner or manager"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-contact-email">
                      Contact email
                    </label>
                    <input
                      id="portal-contact-email"
                      className="text-input"
                      name="primaryContactEmail"
                      defaultValue={company.primaryContactEmail || ''}
                      placeholder="owner@yourbusiness.com"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-contact-phone">
                      Contact phone
                    </label>
                    <input
                      id="portal-contact-phone"
                      className="text-input"
                      name="primaryContactPhone"
                      defaultValue={company.primaryContactPhone || ''}
                      placeholder="+1 555 555 5555"
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">CRM setup</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-crm-provider">
                      CRM provider
                    </label>
                    <select id="portal-crm-provider" className="select-input" name="crmProvider" defaultValue={company.crmProvider}>
                      {Object.values(CrmProvider).map((provider) => (
                        <option key={provider} value={provider}>
                          {providerLabel(provider)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-crm-api-key">
                      CRM API key
                    </label>
                    <input
                      id="portal-crm-api-key"
                      className="text-input"
                      name="crmApiKey"
                      type="password"
                      placeholder={crmCredentialsSaved ? 'Saved securely. Enter a new key only to replace it.' : 'Paste your CRM API key'}
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-crm-secondary-key">
                      CRM second key or account ID
                    </label>
                    <input
                      id="portal-crm-secondary-key"
                      className="text-input"
                      name="crmSecondaryKey"
                      type="password"
                      placeholder="Optional second key, account ID, or location ID"
                    />
                  </div>
                </div>
                <span className="tiny-muted">
                  {crmCredentialsSaved
                    ? 'Your CRM keys are already saved securely. Leave these blank if you do not want to replace them.'
                    : 'You can save one or two CRM keys here. Once saved, they are hidden from this page.'}
                </span>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Booking setup</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-booking-platform">
                      Booking platform name
                    </label>
                    <input
                      id="portal-booking-platform"
                      className="text-input"
                      name="bookingPlatformName"
                      defaultValue={bookingPlatformName}
                      placeholder="Boulevard, Vagaro, Jane, etc."
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-booking-url">
                      Booking platform URL
                    </label>
                    <input
                      id="portal-booking-url"
                      className="text-input"
                      name="bookingPlatformUrl"
                      defaultValue={bookingPlatformUrl}
                      placeholder="https://..."
                    />
                  </div>
                </div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-booking-api-key">
                      Booking API key
                    </label>
                    <input
                      id="portal-booking-api-key"
                      className="text-input"
                      name="bookingApiKey"
                      type="password"
                      placeholder={bookingCredentialsSaved ? 'Saved securely. Enter a new key only to replace it.' : 'Paste your booking API key'}
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="portal-booking-secondary-key">
                      Booking second key or secret
                    </label>
                    <input
                      id="portal-booking-secondary-key"
                      className="text-input"
                      name="bookingSecondaryKey"
                      type="password"
                      placeholder="Optional second key or secret"
                    />
                  </div>
                </div>
                <span className="tiny-muted">
                  {bookingCredentialsSaved
                    ? 'Your booking credentials are already saved securely. Leave these blank if you do not want to replace them.'
                    : 'You can save one or two booking credentials here. Once saved, they are hidden from this page.'}
                </span>
              </div>

              <div className="inline-actions">
                <button type="submit" className="button">
                  Save client setup
                </button>
              </div>
            </form>
          </section>

          <aside className="panel-stack client-record-sidebar">
            <section className="panel panel-stack">
              <div className="metric-label">Setup snapshot</div>
              <div className="client-record-sidebar-grid">
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">CRM provider</span>
                  <strong>{providerLabel(company.crmProvider)}</strong>
                </div>
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">CRM keys</span>
                  <strong>{crmCredentialsSaved ? 'Saved securely' : 'Not saved yet'}</strong>
                </div>
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">Booking platform</span>
                  <strong>{bookingPlatformName || 'Not saved yet'}</strong>
                </div>
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">Booking keys</span>
                  <strong>{bookingCredentialsSaved ? 'Saved securely' : 'Not saved yet'}</strong>
                </div>
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">Website</span>
                  <strong>{company.website || 'Not saved yet'}</strong>
                </div>
                <div className="client-record-sidebar-item">
                  <span className="key-value-label">Workspace created</span>
                  <strong>{formatCompactDateTime(company.createdAt)}</strong>
                </div>
              </div>
            </section>

            <section className="panel panel-stack client-public-support-card">
              <div className="metric-label">Need help?</div>
              <h2 className="section-title">What to send us</h2>
              <div className="workspace-list">
                <div className="workspace-list-item">
                  <strong>CRM setup</strong>
                  <span className="tiny-muted">Choose the provider and add the API key your CRM uses for lead creation.</span>
                </div>
                <div className="workspace-list-item">
                  <strong>Booking setup</strong>
                  <span className="tiny-muted">Add the booking platform name, URL, and one or two booking credentials if your system needs them.</span>
                </div>
                <div className="workspace-list-item">
                  <strong>Security</strong>
                  <span className="tiny-muted">Saved API keys are encrypted and will not be shown again after you save them.</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
