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
  const gaps = [
    !hasInboundRouting(company) ? 'Inbound routing number' : null,
    !company.notificationEmail ? 'Business email' : null,
    !company.primaryContactName ? 'Primary contact name' : null,
    !company.primaryContactEmail ? 'Primary contact email' : null,
    !company.primaryContactPhone ? 'Primary contact phone' : null,
    !company.website ? 'Website' : null
  ].filter(Boolean) as string[];

  return gaps;
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

export default async function ClientSetupPage({
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

  const [intakeEvents, activeWorkflowRunCount, latestWorkflowRun, latestInboundMessage, latestOutboundMessage] =
    await Promise.all([
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

  const setupGaps = setupGapsForCompany(company);
  const missingSetup = setupGaps.length > 0;

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

  const paymentFields = [company.retainerCents, company.downPaymentCents];
  const paymentsFilled = paymentFields.filter((value) => typeof value === 'number').length;

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
            <strong>Client setup updated.</strong>
          </div>
          <div className="text-muted">Profile edits are live (routing + notifications + operator context).</div>
        </section>
      )}

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Workspace</div>
            <h2 className="section-title">{company.name}</h2>
            <div className="inline-row">
              <span className={`status-chip ${missingSetup ? 'status-chip-attention' : ''}`}>
                <strong>Setup</strong> {missingSetup ? 'Needs attention' : 'Ready'}
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Profile</strong> {profileFilled}/{profileTotal}
              </span>
              <span className="status-chip status-chip-muted">
                <strong>Payments</strong> {paymentsFilled}/{paymentFields.length}
              </span>
            </div>
          </div>
          <div className="inline-actions">
            <a className="button" href={`/clients/${company.id}/operator`}>
              Operator workspace
            </a>
            <a className="button-secondary" href={`/events?companyId=${encodeURIComponent(company.id)}`}>
              Activity
            </a>
          </div>
        </div>

        <div className="key-value-grid">
          <div className="key-value-card">
            <span className="key-value-label">AI agent health</span>
            <div className="record-stack" style={{ gap: 6 }}>
              <span className="inline-row">
                <span className={`status-dot ${workflowHealthy ? 'ok' : 'warn'}`} />
                <strong>{workflowHealthy ? 'Active' : latestWorkflowRun ? 'Stale' : 'No runs yet'}</strong>
              </span>
              <span className="tiny-muted">
                {latestWorkflowRun
                  ? `${activeWorkflowRunCount} active • Last touched ${formatCompactDateTime(latestWorkflowRun.updatedAt)}`
                  : `${activeWorkflowRunCount} active • No workflow activity logged yet.`}
              </span>
            </div>
          </div>

          <div className="key-value-card">
            <span className="key-value-label">SMS health</span>
            <div className="record-stack" style={{ gap: 6 }}>
              <span className="inline-row">
                <span className={`status-dot ${smsHealthy ? 'ok' : activeSenderNumber ? 'warn' : 'error'}`} />
                <strong>{smsHealthy ? 'Routed' : activeSenderNumber ? 'Sender set, routing missing' : 'No sender configured'}</strong>
              </span>
              <span className="tiny-muted">
                Sender: {activeSenderNumber || '—'} • Last inbound {formatCompactDateTime(latestInboundMessage?.createdAt)} • Last outbound{' '}
                {formatCompactDateTime(latestOutboundMessage?.createdAt)}
              </span>
            </div>
          </div>

          <div className="key-value-card">
            <span className="key-value-label">Google Calendar</span>
            <div className="record-stack" style={{ gap: 6 }}>
              <span className="inline-row">
                <span className="status-dot warn" />
                <strong>Not connected</strong>
              </span>
              <span className="tiny-muted">Connection UI not implemented yet.</span>
            </div>
          </div>

          <div className="key-value-card">
            <span className="key-value-label">Payments</span>
            <div className="record-stack" style={{ gap: 6 }}>
              <span>
                Retainer: <strong>{formatUsd(company.retainerCents)}</strong> • Down payment: <strong>{formatUsd(company.downPaymentCents)}</strong>
              </span>
              <span className="tiny-muted">Store retainer + down payment for operator context (does not bill yet).</span>
            </div>
          </div>
        </div>
      </section>

      <details id="setup" className="panel panel-stack" open={notice === 'updated' || missingSetup}>
        <summary className="details-summary">
          Client profile {setupGaps.length > 0 ? `(${setupGaps.join(', ')})` : '(source of truth)'}
        </summary>
        <div className="panel-stack">
          <div className="panel-stack" style={{ gap: 8 }}>
            <div className="metric-label">Source of truth</div>
            <div className="page-copy">
              Website signup gets this client into the system. From this point forward, edit the profile here and the CRM becomes the live source of truth for notifications, routing, and how the team works this clinic.
            </div>
            {(latestSignupEvent || latestOnboardingEvent) && (
              <div className="tiny-muted">
                {latestSignupEvent
                  ? `Imported from ${importedSourceLabel || 'website signup'} on ${formatCompactDateTime(latestSignupEvent.createdAt)}`
                  : 'No signup event recorded yet.'}
                {importedContactName ? ` • Contact: ${importedContactName}` : ''}
                {importedNotificationEmail ? ` • Email: ${importedNotificationEmail}` : ''}
                {latestOnboardingEvent ? ` • Onboarding received ${formatCompactDateTime(latestOnboardingEvent.createdAt)}` : ''}
              </div>
            )}
          </div>
          {setupGaps.length > 0 && (
            <div className="readiness-pills">
              {setupGaps.map((gap) => (
                <span key={gap} className="readiness-pill is-warn">
                  {gap}
                </span>
              ))}
            </div>
          )}
          <form action={updateCompanyAction} className="panel-stack">
            <input type="hidden" name="companyId" value={company.id} />
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-name">
                  Client name
                </label>
                <input id="client-name" className="text-input" name="name" defaultValue={company.name} />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-notification">
                  Notification email
                </label>
                <input
                  id="client-notification"
                  className="text-input"
                  name="notificationEmail"
                  defaultValue={company.notificationEmail || ''}
                  placeholder="appointments@client.com"
                />
              </div>
            </div>
            <div className="workspace-filter-row">
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
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-primary-contact-name">
                  Primary contact name
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
                  Primary contact email
                </label>
                <input
                  id="client-primary-contact-email"
                  className="text-input"
                  name="primaryContactEmail"
                  defaultValue={company.primaryContactEmail || ''}
                  placeholder="owner@client.com"
                />
              </div>
            </div>
            <div className="workspace-filter-row">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="client-primary-contact-phone">
                  Primary contact phone
                </label>
                <input
                  id="client-primary-contact-phone"
                  className="text-input"
                  name="primaryContactPhone"
                  defaultValue={company.primaryContactPhone || ''}
                  placeholder="(555) 555-5555"
                />
              </div>
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
              <span className="tiny-muted">One number can belong to only one client. Add one number per line so replies stay tied to the right workspace.</span>
            </div>
            <div className="inline-actions">
              <button type="submit" className="button">
                Save profile
              </button>
            </div>
          </form>
        </div>
      </details>
    </LayoutShell>
  );
}
