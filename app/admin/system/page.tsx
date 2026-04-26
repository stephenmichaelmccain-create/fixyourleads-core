import { headers } from 'next/headers';
import { CrmProvider, Prisma } from '@prisma/client';
import { LayoutShell } from '@/app/components/LayoutShell';
import { emptyClientCalendarSetupState, parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import { getRuntimeHealth } from '@/lib/health';
import { safeLoadDb } from '@/lib/ui-data';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RuntimeHealth = Awaited<ReturnType<typeof getRuntimeHealth>>;

type SetupEventType = 'client_telnyx_setup_updated' | 'client_calendar_setup_updated';

type ConnectionRow = {
  id: string;
  name: string;
  webhookLive: boolean;
  calendarLive: boolean;
  crmLive: boolean;
  crmProvider: CrmProvider;
  lastUpdatedAt: Date;
  missingLabels: string[];
  fullyLive: boolean;
};

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

function formatDateTime(value: Date | string | null | undefined) {
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

function queueSummary(health: RuntimeHealth) {
  if (health.queueHealth.some((queue) => queue.status === 'error')) {
    return {
      label: 'Needs attention',
      detail: 'One or more worker queues have failed jobs.',
      tone: 'error' as const
    };
  }

  if (health.queueHealth.some((queue) => queue.status === 'missing_config')) {
    return {
      label: 'Missing config',
      detail: 'Some queue wiring is not configured yet.',
      tone: 'warn' as const
    };
  }

  return {
    label: 'Healthy',
    detail: 'Worker queues are live and processing normally.',
    tone: 'ok' as const
  };
}

function summaryTone(health: RuntimeHealth) {
  return health.ok ? 'ok' : 'warn';
}

function summaryTitle(health: RuntimeHealth) {
  return health.ok ? 'System is up and the core runtime is healthy.' : 'System is live, but something needs attention.';
}

function browserLabel(userAgent: string) {
  if (/Edg\//i.test(userAgent)) return 'Microsoft Edge';
  if (/OPR\//i.test(userAgent)) return 'Opera';
  if (/Chrome\//i.test(userAgent)) return 'Chrome';
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return 'Safari';
  if (/Firefox\//i.test(userAgent)) return 'Firefox';
  return 'Unknown browser';
}

function platformLabel(userAgent: string) {
  if (/Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iOS';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Unknown platform';
}

function statusDotClass(isLive: boolean) {
  return isLive ? 'ok' : 'error';
}

function statusText(isLive: boolean, liveLabel = 'Live', downLabel = 'Needs hookup') {
  return isLive ? liveLabel : downLabel;
}

async function loadConnectionRows() {
  const companies = await safeLoadDb(
    () =>
      db.company.findMany({
        select: {
          id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          crmProvider: true,
          crmCredentialsEncrypted: true
        }
      }),
    [] as Array<{
      id: string;
      name: string;
      createdAt: Date;
      updatedAt: Date;
      crmProvider: CrmProvider;
      crmCredentialsEncrypted: string | null;
    }>
  );

  if (companies.length === 0) {
    return [];
  }

  const events = await safeLoadDb(
    () =>
      db.eventLog.findMany({
        where: {
          companyId: { in: companies.map((company) => company.id) },
          eventType: {
            in: ['client_telnyx_setup_updated', 'client_calendar_setup_updated']
          }
        },
        orderBy: { createdAt: 'desc' },
        select: {
          companyId: true,
          eventType: true,
          payload: true,
          createdAt: true
        }
      }),
    [] as Array<{
      companyId: string;
      eventType: SetupEventType;
      payload: Prisma.JsonValue;
      createdAt: Date;
    }>
  );

  const latestEventByCompanyAndType = new Map<string, { payload: unknown; createdAt: Date }>();

  for (const event of events) {
    const key = `${event.companyId}:${event.eventType}`;
    if (!latestEventByCompanyAndType.has(key)) {
      latestEventByCompanyAndType.set(key, { payload: event.payload, createdAt: event.createdAt });
    }
  }

  return companies
    .map<ConnectionRow>((company) => {
      const telnyxEvent = latestEventByCompanyAndType.get(`${company.id}:client_telnyx_setup_updated`);
      const calendarEvent = latestEventByCompanyAndType.get(`${company.id}:client_calendar_setup_updated`);

      const telnyxState = telnyxEvent ? parseTelnyxSetupPayload(telnyxEvent.payload) : emptyTelnyxSetupState;
      const calendarState = calendarEvent ? parseClientCalendarSetupPayload(calendarEvent.payload) : emptyClientCalendarSetupState;

      const webhookLive = Boolean(telnyxState.webhookConfigured || telnyxState.webhookUrl);
      const calendarLive = Boolean(
        calendarState.googleOauthConnected ||
          calendarState.sharedCalendarCreated ||
          calendarState.syncTestPassed ||
          calendarState.googleCalendarId ||
          calendarState.externalCalendarId ||
          calendarState.externalPlatformName
      );
      const crmLive = Boolean(company.crmProvider !== CrmProvider.NONE && company.crmCredentialsEncrypted);
      const fullyLive = webhookLive && calendarLive && crmLive;

      const missingLabels = [
        webhookLive ? null : 'Webhook',
        calendarLive ? null : 'Calendar',
        crmLive ? null : 'CRM'
      ].filter(Boolean) as string[];

      const lastUpdatedAt = [company.updatedAt, telnyxEvent?.createdAt, calendarEvent?.createdAt]
        .filter(Boolean)
        .sort((left, right) => new Date(right as Date).getTime() - new Date(left as Date).getTime())[0] as Date;

      return {
        id: company.id,
        name: company.name,
        webhookLive,
        calendarLive,
        crmLive,
        crmProvider: company.crmProvider,
        lastUpdatedAt,
        missingLabels,
        fullyLive
      };
    })
    .sort((left, right) => {
      if (left.fullyLive !== right.fullyLive) {
        return Number(left.fullyLive) - Number(right.fullyLive);
      }

      if (left.missingLabels.length !== right.missingLabels.length) {
        return right.missingLabels.length - left.missingLabels.length;
      }

      return left.name.localeCompare(right.name);
    });
}

export default async function AdminSystemPage() {
  const [health, connectionRows, headerStore] = await Promise.all([getRuntimeHealth(), loadConnectionRows(), headers()]);
  const queue = queueSummary(health);
  const currentTimestamp = new Date();
  const userAgent = headerStore.get('user-agent') || '';
  const forwardedHost = headerStore.get('x-forwarded-host') || headerStore.get('host') || 'Unknown host';
  const forwardedProto = headerStore.get('x-forwarded-proto') || 'https';
  const liveAccounts = connectionRows.filter((row) => row.fullyLive).length;

  return (
    <LayoutShell
      title="Settings"
      description="System health, current admin session, and live account hookups."
      section="system"
      hidePageHeader
    >
      <section className={`panel panel-stack ${summaryTone(health) === 'ok' ? 'panel-success' : 'panel-attention'}`}>
        <div className="record-header">
          <div className="panel-stack" style={{ gap: 8 }}>
            <div className="metric-label">Settings</div>
            <h2 className="section-title section-title-large">{summaryTitle(health)}</h2>
            <p className="page-copy">Keep an eye on the live runtime, this admin session, and whether each client account is wired into FYL.</p>
          </div>
          <div className="tiny-muted">Last checked: {formatDateTime(health.timestamp)}</div>
        </div>

        <div className="key-value-grid">
          <div className="key-value-card">
            <span className="key-value-label">System</span>
            <div className="inline-row" style={{ gap: 8 }}>
              <span className={`status-dot ${health.ok ? 'ok' : 'warn'}`} />
              <strong>{health.ok ? 'Online' : 'Needs attention'}</strong>
            </div>
            <div className="tiny-muted">{health.service}</div>
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Queue</span>
            <div className="inline-row" style={{ gap: 8 }}>
              <span className={`status-dot ${queue.tone}`} />
              <strong>{queue.label}</strong>
            </div>
            <div className="tiny-muted">{queue.detail}</div>
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Worker heartbeat</span>
            <div className="inline-row" style={{ gap: 8 }}>
              <span className={`status-dot ${health.checks.workerHeartbeat.status === 'ok' ? 'ok' : 'error'}`} />
              <strong>{health.checks.workerHeartbeat.status === 'ok' ? 'Live' : 'Offline'}</strong>
            </div>
            <div className="tiny-muted">{health.checks.workerHeartbeat.detail || 'No heartbeat detail yet.'}</div>
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Account hookups</span>
            <div className="inline-row" style={{ gap: 8 }}>
              <span className={`status-dot ${liveAccounts === connectionRows.length && connectionRows.length > 0 ? 'ok' : 'warn'}`} />
              <strong>
                {liveAccounts}/{connectionRows.length}
              </strong>
            </div>
            <div className="tiny-muted">Client accounts fully connected across webhook, calendar, and CRM.</div>
          </div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack" style={{ gap: 8 }}>
            <div className="metric-label">Current session</div>
            <h2 className="section-title">This admin console is live in the browser you are using right now.</h2>
            <div className="text-muted">The app does not have named employee auth wired into this page yet, so this block stays focused on the current console session.</div>
          </div>
        </div>

        <div className="key-value-grid">
          <div className="key-value-card">
            <span className="key-value-label">Access</span>
            <strong>Admin system</strong>
            <div className="tiny-muted">Shared console session</div>
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Browser</span>
            <strong>{browserLabel(userAgent)}</strong>
            <div className="tiny-muted">{platformLabel(userAgent)}</div>
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Current host</span>
            <strong>{forwardedHost}</strong>
            <div className="tiny-muted">{forwardedProto.toUpperCase()} connection</div>
          </div>
          <div className="key-value-card">
            <span className="key-value-label">Last refreshed</span>
            <strong>{formatDateTime(currentTimestamp)}</strong>
            <div className="tiny-muted">Pulled fresh from the live app state</div>
          </div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack" style={{ gap: 8 }}>
            <div className="metric-label">Live account feed</div>
            <h2 className="section-title">Webhook and hookup status by account.</h2>
            <div className="text-muted">
              Every new account needs its webhook, calendar, and CRM connected before it is fully live in the system.
            </div>
          </div>
          <div className="status-chip status-chip-muted">
            <span className="status-dot ok" />
            {liveAccounts} live
          </div>
        </div>

        {connectionRows.length === 0 ? (
          <div className="empty-state">No client accounts exist yet, so there are no webhook or connection statuses to show.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Webhook</th>
                  <th>Calendar</th>
                  <th>CRM</th>
                  <th>Last updated</th>
                </tr>
              </thead>
              <tbody>
                {connectionRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <a className="table-link" href={`/clients/${row.id}/workflow`}>
                          <strong>{row.name}</strong>
                        </a>
                        <div className="tiny-muted">
                          {row.fullyLive ? 'Fully live in FYL.' : `Needs ${row.missingLabels.join(', ')} hookup.`}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="inline-row" style={{ gap: 8 }}>
                        <span className={`status-dot ${statusDotClass(row.webhookLive)}`} />
                        <strong>{statusText(row.webhookLive)}</strong>
                      </div>
                    </td>
                    <td>
                      <div className="inline-row" style={{ gap: 8 }}>
                        <span className={`status-dot ${statusDotClass(row.calendarLive)}`} />
                        <strong>{statusText(row.calendarLive)}</strong>
                      </div>
                    </td>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <div className="inline-row" style={{ gap: 8 }}>
                          <span className={`status-dot ${statusDotClass(row.crmLive)}`} />
                          <strong>{statusText(row.crmLive)}</strong>
                        </div>
                        <div className="tiny-muted">{providerLabel(row.crmProvider)}</div>
                      </div>
                    </td>
                    <td className="tiny-muted">{formatDateTime(row.lastUpdatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </LayoutShell>
  );
}
