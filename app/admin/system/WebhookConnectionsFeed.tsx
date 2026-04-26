import { CrmProvider, Prisma } from '@prisma/client';
import { emptyClientCalendarSetupState, parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import { db } from '@/lib/db';
import { safeLoadDb } from '@/lib/ui-data';

export type SetupEventType = 'client_telnyx_setup_updated' | 'client_calendar_setup_updated';

export type ConnectionRow = {
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

function statusDotClass(isLive: boolean) {
  return isLive ? 'ok' : 'error';
}

function statusText(isLive: boolean, liveLabel = 'Live', downLabel = 'Needs hookup') {
  return isLive ? liveLabel : downLabel;
}

export async function loadConnectionRows() {
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

export async function WebhookConnectionsFeed({
  showHeader = true
}: {
  showHeader?: boolean;
}) {
  const connectionRows = await loadConnectionRows();
  const liveAccounts = connectionRows.filter((row) => row.fullyLive).length;

  return (
    <section className="panel panel-stack">
      {showHeader ? (
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
      ) : (
        <div className="record-header">
          <div className="panel-stack" style={{ gap: 6 }}>
            <div className="metric-label">Webhook connections</div>
            <div className="text-muted">Live connection status across webhook, calendar, and CRM hookups.</div>
          </div>
          <div className="status-chip status-chip-muted">
            <span className="status-dot ok" />
            {liveAccounts} live
          </div>
        </div>
      )}

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
  );
}
