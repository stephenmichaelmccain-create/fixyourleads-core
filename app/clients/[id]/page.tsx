import { notFound, redirect } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { ClientViewLinkActions } from '@/app/clients/[id]/ClientViewLinkActions';
import { LayoutShell } from '@/app/components/LayoutShell';
import { updateCompanyAction } from '@/app/companies/actions';
import { parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { buildClientViewPath } from '@/lib/client-view-auth';
import { db } from '@/lib/db';
import { parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import { safeLoadDb } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
  window?: string;
  status?: string;
  source?: string;
  q?: string;
  queue?: string;
  sort?: string;
  dir?: string;
  page?: string;
  conversationId?: string;
  leadId?: string;
  send?: string;
  detail?: string;
  booking?: string;
  notification?: string;
  notificationDetail?: string;
  confirmation?: string;
  confirmationDetail?: string;
  statusUpdated?: string;
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

function isLikelyOperatorDeepLink(query: Record<string, string | undefined>) {
  const keys: Array<keyof typeof query> = [
    'window',
    'status',
    'source',
    'q',
    'queue',
    'sort',
    'dir',
    'page',
    'conversationId',
    'leadId',
    'send',
    'detail',
    'booking',
    'notification',
    'notificationDetail',
    'confirmation',
    'confirmationDetail',
    'statusUpdated'
  ];

  return keys.some((key) => Boolean(query[key]));
}

function buildOperatorRedirect(companyId: string, query: Record<string, string | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (!value || key === 'notice') {
      continue;
    }

    params.set(key, value);
  }

  const search = params.toString();
  return search ? `/clients/${companyId}/operator?${search}` : `/clients/${companyId}/operator`;
}

type CompanySetupSnapshot = {
  website: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  retainerCents: number | null;
  downPaymentCents: number | null;
};

const emptyCompanySetup: CompanySetupSnapshot = {
  website: null,
  primaryContactName: null,
  primaryContactEmail: null,
  primaryContactPhone: null,
  retainerCents: null,
  downPaymentCents: null
};

export default async function ClientProfilePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParamShape;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};

  if (isLikelyOperatorDeepLink(query)) {
    redirect(buildOperatorRedirect(id, query));
  }

  const notice = query.notice || '';

  const companyBase = await safeLoadDb(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          crmProvider: true,
          crmCredentialsEncrypted: true,
          notificationEmail: true,
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

  if (!companyBase) {
    notFound();
  }

  const companySetup =
    (await safeLoadDb<CompanySetupSnapshot | null>(
      () =>
        db.company.findUnique({
          where: { id },
          select: {
            website: true,
            primaryContactName: true,
            primaryContactEmail: true,
            primaryContactPhone: true,
            retainerCents: true,
            downPaymentCents: true
          }
        }),
      null
    )) ?? emptyCompanySetup;

  const company = {
    ...companyBase,
    ...companySetup
  };

  const [latestVoiceSetupEvent, latestBookingSetupEvent] = await Promise.all([
    safeLoadDb(
      () =>
        db.eventLog.findFirst({
          where: { companyId: id, eventType: 'client_telnyx_setup_updated' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true, createdAt: true }
        }),
      null
    ),
    safeLoadDb(
      () =>
        db.eventLog.findFirst({
          where: { companyId: id, eventType: 'client_calendar_setup_updated' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true, createdAt: true }
        }),
      null
    )
  ]);

  const voiceSetupState = latestVoiceSetupEvent ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload) : null;
  const bookingSetupState = latestBookingSetupEvent ? parseClientCalendarSetupPayload(latestBookingSetupEvent.payload) : null;

  const appBaseUrl = process.env.APP_BASE_URL?.trim() || null;
  const clientViewPath = buildClientViewPath(company.id);
  const clientViewUrl =
    clientViewPath && appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}${clientViewPath}` : clientViewPath;
  const aiVoiceConfigured = Boolean(voiceSetupState?.webhookConfigured || voiceSetupState?.webhookUrl);
  const bookingConfigured = Boolean(bookingSetupState?.externalPlatformName || bookingSetupState?.externalCalendarId);
  const crmConfigured = Boolean(company.crmCredentialsEncrypted);
  const workflowReady = aiVoiceConfigured || bookingConfigured || crmConfigured;

  return (
    <LayoutShell
      title={company.name}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="profile" />

      {notice === 'updated' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Client profile updated.</strong>
          </div>
          <div className="text-muted">Contact details, website info, and client context are now using the latest values.</div>
        </section>
      )}

      {notice === 'approved' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Client approved from website signup.</strong>
          </div>
          <div className="text-muted">The signup details were pushed into this client record so you can keep setup moving from here.</div>
        </section>
      )}

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Client profile</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              Keep the core client record accurate here. Workflow setup now lives in one simple tab so CRM, AI voice, and
              calendar keys stay together instead of being split across separate screens.
            </div>
          </div>
          <div className="workspace-action-rail">
            <a className="button" href={`/clients/${company.id}/workflow`}>
              Workflow
            </a>
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              Activity
            </a>
            <a className="button-secondary" href="#setup">
              Edit
            </a>
          </div>
        </div>

        <div className="client-record-meta-strip">
          <div className="client-record-meta-item">
            <span className="key-value-label">Created</span>
            <strong>{formatCompactDateTime(company.createdAt)}</strong>
          </div>
          <ClientViewLinkActions clientViewUrl={clientViewUrl} variant="simple" />
        </div>
      </section>

      <section className="panel panel-stack" id="setup">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Profile editor</div>
                <h3 className="section-title">Keep the record accurate</h3>
                <div className="record-subtitle">
                  This page is just the editable client record now. Use Workflow for keys and webhook setup.
                </div>
              </div>
            </div>

            <form action={updateCompanyAction} className="panel-stack client-profile-form">
              <input type="hidden" name="companyId" value={company.id} />

              <div className="client-profile-section">
                <div className="metric-label">Business details</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-name">
                      Client name
                    </label>
                    <input id="client-name" className="text-input" name="name" defaultValue={company.name} />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-notification">
                      Business email
                    </label>
                    <input
                      id="client-notification"
                      className="text-input"
                      name="notificationEmail"
                      defaultValue={company.notificationEmail || ''}
                      placeholder="appointments@client.com"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-website">
                      Website
                    </label>
                    <input
                      id="client-website"
                      className="text-input"
                      name="website"
                      defaultValue={company.website || ''}
                      placeholder="https://client.com"
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Primary contact</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-primary-contact-name">
                      Contact name
                    </label>
                    <input
                      id="client-primary-contact-name"
                      className="text-input"
                      name="primaryContactName"
                      defaultValue={company.primaryContactName || ''}
                      placeholder="Owner name"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-primary-contact-email">
                      Contact email
                    </label>
                    <input
                      id="client-primary-contact-email"
                      className="text-input"
                      name="primaryContactEmail"
                      defaultValue={company.primaryContactEmail || ''}
                      placeholder="owner@client.com"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-primary-contact-phone">
                      Contact phone
                    </label>
                    <input
                      id="client-primary-contact-phone"
                      className="text-input"
                      name="primaryContactPhone"
                      defaultValue={company.primaryContactPhone || ''}
                      placeholder="(555) 555-5555"
                    />
                  </div>
                </div>
              </div>

              <div className="client-profile-section">
                <div className="metric-label">Commercials</div>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-retainer">
                      Retainer (monthly USD)
                    </label>
                    <input
                      id="client-retainer"
                      className="text-input"
                      name="retainer"
                      defaultValue={typeof company.retainerCents === 'number' ? String(company.retainerCents / 100) : ''}
                      placeholder="1500"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-down-payment">
                      Down payment (USD)
                    </label>
                    <input
                      id="client-down-payment"
                      className="text-input"
                      name="downPayment"
                      defaultValue={typeof company.downPaymentCents === 'number' ? String(company.downPaymentCents / 100) : ''}
                      placeholder="500"
                      inputMode="decimal"
                    />
                  </div>
                </div>
              </div>

              <div className="inline-actions">
                <button type="submit" className="button">
                  Save profile
                </button>
                <span className={`status-chip ${workflowReady ? 'status-chip-muted' : 'status-chip-attention'}`}>
                  <strong>Workflow</strong> {workflowReady ? 'In place' : 'Needs setup'}
                </span>
              </div>
            </form>
      </section>
    </LayoutShell>
  );
}
