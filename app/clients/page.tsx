import { LayoutShell } from '@/app/components/LayoutShell';
import { DeleteClientButton } from '@/app/clients/DeleteClientButton';
import { db } from '@/lib/db';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { normalizePhone } from '@/lib/phone';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoadDb } from '@/lib/ui-data';
import styles from '@/app/clients/ClientsPage.module.css';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

function startOfTrailingDays(days: number) {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - (days - 1));
  return value;
}

function startOfToday() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfCurrentMonth() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(1);
  return value;
}

function isAnsweredCallOutcome(outcome: string) {
  const normalized = outcome.trim().toLowerCase();
  return normalized !== 'no answer' && normalized !== 'left voicemail';
}

function healthState(options: {
  hasRouting: boolean;
  hasNotificationEmail: boolean;
  callsToday: number;
  answeredCalls: number;
  callsThisMonth: number;
  appointmentsThisWeek: number;
}) {
  if (!options.hasRouting || !options.hasNotificationEmail) {
    return {
      tone: 'error' as const,
      label: 'At risk',
      reason: !options.hasRouting ? 'Routing missing' : 'Notification email missing'
    };
  }

  if (options.callsThisMonth === 0) {
    return {
      tone: 'warn' as const,
      label: 'Quiet',
      reason: 'No calls logged this month'
    };
  }

  if (options.answeredCalls === 0) {
    return {
      tone: 'warn' as const,
      label: 'Needs review',
      reason: 'No answered calls this month'
    };
  }

  if (options.appointmentsThisWeek > 0) {
    return {
      tone: 'ok' as const,
      label: 'Healthy',
      reason: `${options.appointmentsThisWeek} appt${options.appointmentsThisWeek === 1 ? '' : 's'} this week`
    };
  }

  if (options.callsToday > 0) {
    return {
      tone: 'ok' as const,
      label: 'Active',
      reason: `${options.callsToday} call${options.callsToday === 1 ? '' : 's'} today`
    };
  }

  return {
    tone: 'ok' as const,
    label: 'Healthy',
    reason: `${options.answeredCalls} answered call${options.answeredCalls === 1 ? '' : 's'} this month`
  };
}

function formatRelativeDay(value: Date | null) {
  if (!value) {
    return 'No activity yet';
  }

  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    Math.round((value.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    'day'
  );
}

function websiteHref(website?: string | null) {
  if (!website) {
    return '';
  }

  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function healthChipToneClass(tone: 'ok' | 'warn' | 'error') {
  if (tone === 'ok') return styles.healthChipOk;
  if (tone === 'warn') return styles.healthChipWarn;
  return styles.healthChipError;
}

export default async function ClientsPage({
  searchParams
}: {
  searchParams?: Promise<{
    notice?: string;
    clientId?: string;
    companyId?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const notice = params.notice || '';

  if (params.clientId) {
    redirect(`/clients/${params.clientId}`);
  }

  const weekStart = startOfTrailingDays(7);
  const todayStart = startOfToday();
  const monthStart = startOfCurrentMonth();

  const clients = await safeLoadDb(
    () =>
      db.company.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          website: true,
          primaryContactPhone: true,
          notificationEmail: true,
          telnyxInboundNumber: true,
          createdAt: true,
          telnyxInboundNumbers: {
            select: { number: true }
          },
          appointments: {
            where: {
              createdAt: { gte: weekStart }
            },
            select: { createdAt: true, startTime: true },
            orderBy: [{ createdAt: 'desc' }, { startTime: 'desc' }]
          },
          events: {
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      }),
    []
  );

  const approvedSignupRows = await (clients.length > 0
    ? safeLoadDb(
        () =>
          db.eventLog.findMany({
            where: {
              companyId: { in: clients.map((client) => client.id) },
              eventType: 'client_signup_approved'
            },
            select: {
              companyId: true
            }
          }),
        []
      )
    : Promise.resolve([]));

  const [signupQueueRows, approvedSignupQueueRows] = await Promise.all([
    safeLoadDb(
      () =>
        db.eventLog.findMany({
          where: {
            eventType: 'client_signup_received'
          },
          select: {
            companyId: true
          }
        }),
      []
    ),
    safeLoadDb(
      () =>
        db.eventLog.findMany({
          where: {
            eventType: 'client_signup_approved'
          },
          select: {
            companyId: true
          }
        }),
      []
    )
  ]);

  const approvedCompanyIds = new Set(approvedSignupRows.map((event) => event.companyId));
  const approvedSignupQueueCompanyIds = new Set(approvedSignupQueueRows.map((event) => event.companyId));
  const pendingSignupCount = signupQueueRows.filter(
    (event) => !approvedSignupQueueCompanyIds.has(event.companyId)
  ).length;
  const liveClients = clients.filter((client) => approvedCompanyIds.has(client.id) || !isLikelyTestWorkspaceName(client.name));
  const companyIds = liveClients.map((client) => client.id);

  const prospectCallRows = await (companyIds.length > 0
    ? safeLoadDb(
        () =>
          db.prospect.findMany({
            where: {
              companyId: { in: companyIds }
            },
            select: {
              companyId: true,
              lastCallAt: true,
              callLogs: {
                where: {
                  createdAt: { gte: monthStart }
                },
                select: {
                  createdAt: true,
                  outcome: true
                }
              }
            }
          }),
        []
      )
    : Promise.resolve([]));

  const callMetricsByCompanyId = new Map<
    string,
    { callsToday: number; answeredCalls: number; callsThisMonth: number; latestCallAt: Date | null }
  >();

  for (const row of prospectCallRows) {
    const current = callMetricsByCompanyId.get(row.companyId) || {
      callsToday: 0,
      answeredCalls: 0,
      callsThisMonth: 0,
      latestCallAt: null
    };

    if (row.lastCallAt && (!current.latestCallAt || row.lastCallAt > current.latestCallAt)) {
      current.latestCallAt = row.lastCallAt;
    }

    for (const call of row.callLogs) {
      current.callsThisMonth += 1;

      if (call.createdAt >= todayStart) {
        current.callsToday += 1;
      }

      if (isAnsweredCallOutcome(call.outcome)) {
        current.answeredCalls += 1;
      }

      if (!current.latestCallAt || call.createdAt > current.latestCallAt) {
        current.latestCallAt = call.createdAt;
      }
    }

    callMetricsByCompanyId.set(row.companyId, current);
  }

  const rows = liveClients
    .map((client) => {
      const callMetrics = callMetricsByCompanyId.get(client.id) || {
        callsToday: 0,
        answeredCalls: 0,
        callsThisMonth: 0,
        latestCallAt: null
      };
      const appointmentsThisWeek = client.appointments.length;
      const health = healthState({
        hasRouting: hasInboundRouting(client),
        hasNotificationEmail: Boolean(client.notificationEmail),
        callsToday: callMetrics.callsToday,
        answeredCalls: callMetrics.answeredCalls,
        callsThisMonth: callMetrics.callsThisMonth,
        appointmentsThisWeek
      });
      const lastActivityAt = callMetrics.latestCallAt || client.appointments[0]?.createdAt || client.events[0]?.createdAt || client.createdAt;
      const inboundNumbers = allInboundNumbers(client);
      const connectedNumbers = inboundNumbers.length;
      const normalizedOwnerPhone = normalizePhone(client.primaryContactPhone || '');
      const normalizedAiPhone = normalizePhone(inboundNumbers[0] || client.telnyxInboundNumber || '');

      return {
        id: client.id,
        name: client.name,
        health,
        callsToday: callMetrics.callsToday,
        answeredCalls: callMetrics.answeredCalls,
        callsThisMonth: callMetrics.callsThisMonth,
        appointmentsThisWeek,
        lastActivityAt,
        connectedNumbers,
        websiteHref: websiteHref(client.website),
        ownerCallHref: normalizedOwnerPhone ? `tel:${normalizedOwnerPhone}` : '',
        aiCallHref: normalizedAiPhone ? `tel:${normalizedAiPhone}` : ''
      };
    })
    .sort((left, right) => {
      const toneRank = { error: 0, warn: 1, ok: 2 };
      if (toneRank[left.health.tone] !== toneRank[right.health.tone]) {
        return toneRank[left.health.tone] - toneRank[right.health.tone];
      }

      if (left.callsToday !== right.callsToday) {
        return right.callsToday - left.callsToday;
      }

      if (left.answeredCalls !== right.answeredCalls) {
        return right.answeredCalls - left.answeredCalls;
      }

      if (left.callsThisMonth !== right.callsThisMonth) {
        return right.callsThisMonth - left.callsThisMonth;
      }

      if (left.appointmentsThisWeek !== right.appointmentsThisWeek) {
        return right.appointmentsThisWeek - left.appointmentsThisWeek;
      }

      return left.name.localeCompare(right.name);
    });

  return (
    <LayoutShell
      title="Clients"
      section="clients"
      hidePageHeader
    >
      {notice && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${notice === 'duplicate_routing' ? 'warn' : 'ok'}`} />
            <strong>
              {notice === 'duplicate_routing'
                ? 'That phone number already belongs to another client.'
                : notice === 'approved'
                  ? 'Client approved and moved into the main clients page.'
                  : notice === 'deleted'
                    ? 'Client deleted.'
                  : notice === 'created'
                  ? 'Client workspace created.'
                  : 'Client setup updated.'}
            </strong>
          </div>
        </section>
      )}

      <section className="panel panel-stack">
        <div className="record-header client-list-header client-list-header-actions-only">
          <div className="client-list-actions">
            <Link className={`button ${styles.toolbarButton}`} href="/clients/intake">
              <span>Intake queue</span>
              <span className={styles.toolbarBadge}>{pendingSignupCount}</span>
            </Link>
            <Link className="button-secondary" href="/clients/new">
              + Add Client
            </Link>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="client-table-col-health">
                  <span className="client-table-header-label">Health</span>
                </th>
                <th className="client-table-col-name">
                  <span className="client-table-header-label">Client Name</span>
                </th>
                <th className="client-table-col-metric client-table-metric-head">
                  <span className="client-table-header-label">Calls Today</span>
                </th>
                <th className="client-table-col-metric client-table-metric-head">
                  <span className="client-table-header-label">Calls This Month</span>
                </th>
                <th className="client-table-col-metric client-table-metric-head">
                  <span className="client-table-header-label">Answered Calls</span>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">No live clients yet. Add the first client workspace to get started.</div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} id={`client-${row.id}`}>
                    <td className="client-table-col-health">
                      <span className="client-health-cell" title={`${row.health.label} · ${row.health.reason}`}>
                        <span className={`status-dot ${row.health.tone}`} />
                      </span>
                    </td>
                    <td className="client-table-col-name">
                      <div className={`client-name-cell ${styles.clientNameCell}`}>
                        <div className={styles.clientNameMain}>
                          <Link className="table-link" href={`/clients/${row.id}`}>
                            <strong>{row.name}</strong>
                          </Link>
                        </div>
                        <div className={styles.healthLine}>
                          <span className={`${styles.healthChip} ${healthChipToneClass(row.health.tone)}`}>{row.health.label}</span>
                          <span className="tiny-muted">
                            {row.health.reason} · {row.connectedNumbers} number{row.connectedNumbers === 1 ? '' : 's'} ·{' '}
                            {formatRelativeDay(row.lastActivityAt)}
                          </span>
                        </div>
                        <div className={`client-inline-actions ${styles.inlineActions}`}>
                          {row.aiCallHref ? (
                            <a className="button-secondary button-secondary-compact client-row-action-link" href={row.aiCallHref}>
                              Call AI
                            </a>
                          ) : (
                            <span className="button-secondary button-secondary-compact client-row-action-link is-disabled">Call AI</span>
                          )}
                          {row.websiteHref ? (
                            <a
                              className="button-secondary button-secondary-compact client-row-action-link"
                              href={row.websiteHref}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Website
                            </a>
                          ) : (
                            <span className="button-secondary button-secondary-compact client-row-action-link is-disabled">Website</span>
                          )}
                          {row.ownerCallHref ? (
                            <a className="button-secondary button-secondary-compact client-row-action-link" href={row.ownerCallHref}>
                              Call Owner
                            </a>
                          ) : (
                            <span className="button-secondary button-secondary-compact client-row-action-link is-disabled">Call Owner</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="client-table-col-metric client-table-metric-cell">
                      <span className={`${styles.metricValue}${row.callsToday === 0 ? ` ${styles.metricValueEmpty}` : ''}`}>
                        {row.callsToday}
                      </span>
                    </td>
                    <td className="client-table-col-metric client-table-metric-cell">
                      <span className={`${styles.metricValue}${row.callsThisMonth === 0 ? ` ${styles.metricValueEmpty}` : ''}`}>
                        {row.callsThisMonth}
                      </span>
                    </td>
                    <td className="client-table-col-metric client-table-metric-cell">
                      <span className={`${styles.metricValue}${row.answeredCalls === 0 ? ` ${styles.metricValueEmpty}` : ''}`}>
                        {row.answeredCalls}
                      </span>
                    </td>
                    <td className="client-row-actions-cell">
                      <div className="client-row-actions">
                        <DeleteClientButton companyId={row.id} companyName={row.name} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </LayoutShell>
  );
}
