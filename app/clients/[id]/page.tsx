import { notFound, redirect } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { updateCompanyAction } from '@/app/companies/actions';
import { db } from '@/lib/db';
import { humanizeIntakeSource } from '@/lib/client-intake';
import { safeLoad } from '@/lib/ui-data';
import { allInboundNumbers, companyPrimaryInboundNumber, hasInboundRouting } from '@/lib/inbound-numbers';

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

function formatUsd(cents?: number | null) {
  if (typeof cents !== 'number') {
    return '—';
  }

  const dollars = cents / 100;
  const whole = Number.isFinite(dollars) && Math.round(dollars) === dollars;

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2
  }).format(dollars);
}

function readPayloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
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

function setupGapsForCompany(company: {
  notificationEmail: string | null;
  website: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  telnyxInboundNumber: string | null;
  telnyxInboundNumbers: Array<{ number: string }>;
}) {
  return [
    !hasInboundRouting(company) ? 'Inbound routing number' : null,
    !company.notificationEmail ? 'Business email' : null,
    !company.primaryContactName ? 'Primary contact name' : null,
    !company.primaryContactEmail ? 'Primary contact email' : null,
    !company.primaryContactPhone ? 'Primary contact phone' : null,
    !company.website ? 'Website' : null
  ].filter(Boolean) as string[];
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

  const companyBase = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
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
    (await safeLoad<CompanySetupSnapshot | null>(
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

  const now = new Date();

  const [
    intakeEvents,
    activeWorkflowRunCount,
    latestWorkflowRun,
    latestInboundMessage,
    latestOutboundMessage,
    leadCount,
    activeLeadCount,
    conversationCount,
    messageCount,
    upcomingAppointmentCount
  ] = await Promise.all([
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            companyId: id,
            eventType: {
              in: ['client_signup_received', 'client_onboarding_received']
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 4,
          select: {
            eventType: true,
            createdAt: true,
            payload: true
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.workflowRun.count({
          where: { companyId: id, status: 'ACTIVE' }
        }),
      0
    ),
    safeLoad(
      () =>
        db.workflowRun.findFirst({
          where: { companyId: id },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true, status: true, workflowType: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.message.findFirst({
          where: { companyId: id, direction: 'INBOUND' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.message.findFirst({
          where: { companyId: id, direction: 'OUTBOUND' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        }),
      null
    ),
    safeLoad(() => db.lead.count({ where: { companyId: id } }), 0),
    safeLoad(
      () =>
        db.lead.count({
          where: {
            companyId: id,
            status: {
              in: ['NEW', 'CONTACTED', 'REPLIED']
            }
          }
        }),
      0
    ),
    safeLoad(() => db.conversation.count({ where: { companyId: id } }), 0),
    safeLoad(() => db.message.count({ where: { companyId: id } }), 0),
    safeLoad(
      () =>
        db.appointment.count({
          where: {
            companyId: id,
            startTime: { gte: now },
            status: { in: ['BOOKED', 'CONFIRMED', 'RESCHEDULED'] }
          }
        }),
      0
    )
  ]);

  const latestSignupEvent = intakeEvents.find((event) => event.eventType === 'client_signup_received') || null;
  const latestOnboardingEvent = intakeEvents.find((event) => event.eventType === 'client_onboarding_received') || null;
  const latestSignupPayload = readPayloadRecord(latestSignupEvent?.payload);
  const latestOnboardingPayload = readPayloadRecord(latestOnboardingEvent?.payload);

  const importedSourceLabel = humanizeIntakeSource(payloadString(latestSignupPayload, 'source'));
  const importedContactName =
    payloadString(latestSignupPayload, 'contactName') || payloadString(latestOnboardingPayload, 'contactName');
  const importedNotificationEmail =
    payloadString(latestSignupPayload, 'notificationEmail') ||
    payloadString(latestOnboardingPayload, 'notificationEmail');

  const primaryRoutingNumber = companyPrimaryInboundNumber(company);
  const sharedTelnyxSender = process.env.TELNYX_FROM_NUMBER?.trim() || null;
  const activeSenderNumber = primaryRoutingNumber || sharedTelnyxSender;

  const workflowAgeMs = latestWorkflowRun ? Date.now() - latestWorkflowRun.updatedAt.getTime() : Number.POSITIVE_INFINITY;
  const workflowHealthy = Number.isFinite(workflowAgeMs) && workflowAgeMs <= 24 * 60 * 60 * 1000;
  const smsHealthy = Boolean(activeSenderNumber) && hasInboundRouting(company);

  const profileFields = [
    company.notificationEmail,
    company.website,
    company.primaryContactName,
    company.primaryContactEmail,
    company.primaryContactPhone,
    allInboundNumbers(company).join('')
  ];
  const profileFilled = profileFields.filter((value) => String(value || '').trim()).length;
  const profileTotal = profileFields.length;
  const paymentsFilled = [company.retainerCents, company.downPaymentCents].filter((value) => typeof value === 'number')
    .length;

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
          <div className="text-muted">Routing, notifications, and operator context are now using the latest values.</div>
        </section>
      )}

      <section className="panel panel-stack client-record-hero">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Client profile</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="record-subtitle">
              Keep the core client record accurate here. The other tabs can then focus on testing, carrier setup, booking,
              and monitoring without duplicating these fields.
            </div>
            <div className="inline-row client-record-chip-row">
              <span className="status-chip status-chip-muted">
                <strong>Profile</strong> {profileFilled}/{profileTotal}
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Payments</strong> {paymentsFilled}/2
              </span>
              <span className={`status-chip ${hasInboundRouting(company) ? '' : 'status-chip-attention'}`}>
                <strong>Routing</strong> {hasInboundRouting(company) ? 'Assigned' : 'Needs line'}
              </span>
            </div>
          </div>
          <div className="workspace-action-rail">
            <a className="button" href={`/clients/${company.id}/operator?lab=sms`}>
              Open Comms Lab
            </a>
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              View activity
            </a>
            <a className="button-secondary" href="#setup">
              Edit profile
            </a>
          </div>
        </div>

        <div className="client-record-stats">
          <div className="client-record-stat">
            <span className="metric-label">Leads</span>
            <strong className="workspace-stats-value">{leadCount}</strong>
            <span className="tiny-muted">{activeLeadCount} active in the pipeline</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Conversations</span>
            <strong className="workspace-stats-value">{conversationCount}</strong>
            <span className="tiny-muted">{messageCount} total messages on record</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Upcoming appointments</span>
            <strong className="workspace-stats-value">{upcomingAppointmentCount}</strong>
            <span className="tiny-muted">Booked, confirmed, or rescheduled</span>
          </div>
          <div className="client-record-stat">
            <span className="metric-label">Workflows</span>
            <strong className="workspace-stats-value">{activeWorkflowRunCount}</strong>
            <span className="tiny-muted">
              {latestWorkflowRun ? `${latestWorkflowRun.workflowType} touched ${formatCompactDateTime(latestWorkflowRun.updatedAt)}` : 'No runs yet'}
            </span>
          </div>
        </div>
      </section>

      <div className="client-record-layout">
        <div className="panel-stack">
          <section className="panel panel-stack">
            <div className="record-header">
              <div className="panel-stack">
              <div className="metric-label">Overview</div>
              <h3 className="section-title">Identity, routing, and handoff</h3>
              <div className="record-subtitle">
                  Keep this page focused on the information the rest of the workspace depends on: contact details, routing,
                  notification inboxes, and pricing context.
              </div>
            </div>
            </div>

            <div className="client-record-overview-grid">
              <div className="key-value-card client-record-overview-card">
                <span className="key-value-label">Primary contact</span>
                <strong>{company.primaryContactName || 'Missing primary contact'}</strong>
                <span className="tiny-muted">
                  {[company.primaryContactEmail, company.primaryContactPhone].filter(Boolean).join(' • ') || 'Add the owner or manager who receives updates.'}
                </span>
              </div>
              <div className="key-value-card client-record-overview-card">
                <span className="key-value-label">Routing line</span>
                <strong>{primaryRoutingNumber || activeSenderNumber || 'No sender configured'}</strong>
                <span className="tiny-muted">
                  {hasInboundRouting(company)
                    ? 'Replies map into this client workspace.'
                    : 'Assign a line in Telnyx Setup so replies stop living on fallback routing.'}
                </span>
              </div>
              <div className="key-value-card client-record-overview-card">
                <span className="key-value-label">Notifications</span>
                <strong>{company.notificationEmail || 'Missing notification inbox'}</strong>
                <span className="tiny-muted">
                  {company.website ? `Website: ${company.website}` : 'Add the website so intake and client context stay connected.'}
                </span>
              </div>
              <div className="key-value-card client-record-overview-card">
                <span className="key-value-label">Revenue context</span>
                <strong>
                  {formatUsd(company.retainerCents)} retainer
                  {company.downPaymentCents ? ` • ${formatUsd(company.downPaymentCents)} down` : ''}
                </strong>
                <span className="tiny-muted">Stored for operator context and launch planning.</span>
              </div>
            </div>

            <div className="surface-link-grid">
              <a className="surface-link-card" href={`/clients/${company.id}/operator?lab=sms`}>
                <span className="metric-label">Comms Lab</span>
                <strong>Test SMS routing and review message activity</strong>
                <span className="tiny-muted">Use the live terminal without leaving the client record.</span>
              </a>
              <a className="surface-link-card" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
                <span className="metric-label">Activity log</span>
                <strong>Review webhook, booking, and delivery events</strong>
                <span className="tiny-muted">Useful when QAing intake, workflows, or carrier delivery.</span>
              </a>
              <a className="surface-link-card" href="#setup">
                <span className="metric-label">Profile editor</span>
                <strong>Update routing, contacts, website, and pricing</strong>
                <span className="tiny-muted">All downstream operator tools read from this setup form.</span>
              </a>
            </div>
          </section>

          <section className="panel panel-stack" id="setup">
            <div className="record-header">
              <div className="panel-stack">
                <div className="metric-label">Profile editor</div>
                <h3 className="section-title">Keep the record accurate</h3>
                <div className="record-subtitle">
                  Inspired by modern CRM record pages, this section keeps one obvious edit surface instead of scattering settings
                  across the page.
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
                <div className="metric-label">Routing and pricing</div>
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
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="client-inbound">
                    Assigned client number(s)
                  </label>
                  <textarea
                    id="client-inbound"
                    className="text-area"
                    name="telnyxInboundNumber"
                    defaultValue={allInboundNumbers(company).join('\n')}
                    rows={3}
                  />
                  <span className="tiny-muted">
                    Add one number per line. Each line is treated as a unique routing destination for this client.
                  </span>
                </div>
              </div>

              <div className="inline-actions">
                <button type="submit" className="button">
                  Save profile
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside className="client-record-sidebar">
          <section className="panel panel-stack">
            <div className="metric-label">Snapshot</div>
            <div className="client-record-sidebar-grid">
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Created</span>
                <strong>{formatCompactDateTime(company.createdAt)}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Routing mode</span>
                <strong>{primaryRoutingNumber ? 'Dedicated' : activeSenderNumber ? 'Shared fallback' : 'Missing'}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Messaging status</span>
                <strong>{smsHealthy ? 'Routed' : activeSenderNumber ? 'Fallback only' : 'Missing sender'}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Inbound lines</span>
                <strong>{allInboundNumbers(company).length || 0}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Revenue context</span>
                <strong>{formatUsd(company.retainerCents)}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Last workflow</span>
                <strong>{latestWorkflowRun ? latestWorkflowRun.workflowType : 'None yet'}</strong>
              </div>
              <div className="client-record-sidebar-item">
                <span className="key-value-label">Intake source</span>
                <strong>{importedSourceLabel || 'Manual or unknown'}</strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </LayoutShell>
  );
}
