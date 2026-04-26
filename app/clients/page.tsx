import { LayoutShell } from '@/app/components/LayoutShell';
import { DeleteClientButton } from '@/app/clients/DeleteClientButton';
import { db } from '@/lib/db';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { normalizePhone } from '@/lib/phone';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoadDb } from '@/lib/ui-data';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

function startOfTrailingDays(days: number) {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - (days - 1));
  return value;
}

function healthState(options: {
  unreadMessages: number;
  hasRouting: boolean;
  hasNotificationEmail: boolean;
}) {
  if (!options.hasRouting || !options.hasNotificationEmail) {
    return {
      tone: 'error' as const,
      label: 'At risk',
      reason: !options.hasRouting ? 'Routing missing' : 'Notification email missing'
    };
  }

  if (options.unreadMessages > 0) {
    return {
      tone: 'warn' as const,
      label: 'Attention',
      reason: `${options.unreadMessages} unread message${options.unreadMessages === 1 ? '' : 's'}`
    };
  }

  return {
    tone: 'ok' as const,
    label: 'Healthy',
    reason: 'Everything running smooth'
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
          leads: {
            where: {
              createdAt: { gte: weekStart }
            },
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' }
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

  const approvedCompanyIds = new Set(approvedSignupRows.map((event) => event.companyId));
  const liveClients = clients.filter((client) => approvedCompanyIds.has(client.id) || !isLikelyTestWorkspaceName(client.name));
  const companyIds = liveClients.map((client) => client.id);

  const conversationRows = await (companyIds.length > 0
    ? safeLoadDb(
        () =>
          db.conversation.findMany({
            where: {
              companyId: { in: companyIds }
            },
            include: {
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  direction: true,
                  createdAt: true
                }
              }
            }
          }),
        []
      )
    : Promise.resolve([]));

  const unreadByCompanyId = new Map<string, number>();
  for (const conversation of conversationRows) {
    if (conversation.messages[0]?.direction !== 'INBOUND') {
      continue;
    }

    unreadByCompanyId.set(conversation.companyId, (unreadByCompanyId.get(conversation.companyId) || 0) + 1);
  }

  const rows = liveClients
    .map((client) => {
      const unreadMessages = unreadByCompanyId.get(client.id) || 0;
      const health = healthState({
        unreadMessages,
        hasRouting: hasInboundRouting(client),
        hasNotificationEmail: Boolean(client.notificationEmail)
      });
      const lastActivityAt = client.events[0]?.createdAt || client.appointments[0]?.createdAt || client.leads[0]?.createdAt || null;
      const inboundNumbers = allInboundNumbers(client);
      const connectedNumbers = inboundNumbers.length;
      const normalizedOwnerPhone = normalizePhone(client.primaryContactPhone || '');
      const normalizedAiPhone = normalizePhone(inboundNumbers[0] || client.telnyxInboundNumber || '');

      return {
        id: client.id,
        name: client.name,
        unreadMessages,
        health,
        leadsThisWeek: client.leads.length,
        appointmentsThisWeek: client.appointments.length,
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

      if (left.unreadMessages !== right.unreadMessages) {
        return right.unreadMessages - left.unreadMessages;
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
            <Link className="button" href="/clients/intake">
              Intake queue
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
                  <span className="client-table-header-label">Unread Msgs</span>
                </th>
                <th className="client-table-col-metric client-table-metric-head">
                  <span className="client-table-header-label">Appts This Week</span>
                </th>
                <th className="client-table-col-metric client-table-metric-head">
                  <span className="client-table-header-label">New Leads This Week</span>
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
                      <div className="client-name-cell">
                        <div className="client-name-row">
                          <Link className="table-link" href={`/clients/${row.id}`}>
                            <strong>{row.name}</strong>
                          </Link>
                          <div className="client-inline-actions">
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
                            {row.aiCallHref ? (
                              <a className="button-secondary button-secondary-compact client-row-action-link" href={row.aiCallHref}>
                                Call AI
                              </a>
                            ) : (
                              <span className="button-secondary button-secondary-compact client-row-action-link is-disabled">Call AI</span>
                            )}
                          </div>
                        </div>
                        <span className="tiny-muted">
                          {row.health.reason} · {row.connectedNumbers} number{row.connectedNumbers === 1 ? '' : 's'} ·{' '}
                          {formatRelativeDay(row.lastActivityAt)}
                        </span>
                      </div>
                    </td>
                    <td className="client-table-col-metric client-table-metric-cell">
                      <span className="client-table-metric-value">{row.unreadMessages}</span>
                    </td>
                    <td className="client-table-col-metric client-table-metric-cell">
                      <span className="client-table-metric-value">{row.appointmentsThisWeek}</span>
                    </td>
                    <td className="client-table-col-metric client-table-metric-cell">
                      <span className="client-table-metric-value">{row.leadsThisWeek}</span>
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
