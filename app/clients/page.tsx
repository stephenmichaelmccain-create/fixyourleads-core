import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoad } from '@/lib/ui-data';
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

export default async function ClientsPage({
  searchParams
}: {
  searchParams?: Promise<{
    notice?: string;
    clientId?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const notice = params.notice || '';

  if (params.clientId) {
    redirect(`/clients/${params.clientId}`);
  }

  const weekStart = startOfTrailingDays(7);

  const clients = await safeLoad(
    () =>
      db.company.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
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
    ? safeLoad(
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
    ? safeLoad(
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
      const connectedNumbers = allInboundNumbers(client).length;

      return {
        id: client.id,
        name: client.name,
        unreadMessages,
        health,
        leadsThisWeek: client.leads.length,
        appointmentsThisWeek: client.appointments.length,
        lastActivityAt,
        connectedNumbers
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
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Clients</div>
          </div>
          <div className="inline-actions">
            <a className="button-ghost" href="/clients/intake">
              Intake queue
            </a>
            <a className="button" href="/clients/new">
              + Add Client
            </a>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Health</th>
                <th>Client Name</th>
                <th>Unread Msgs</th>
                <th>Appts This Week</th>
                <th>New Leads This Week</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">No live clients yet. Add the first client workspace to get started.</div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="client-health-cell" title={`${row.health.label} · ${row.health.reason}`}>
                        <span className={`status-dot ${row.health.tone}`} />
                      </span>
                    </td>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <a className="table-link" href={`/clients/${row.id}`}>
                          <strong>{row.name}</strong>
                        </a>
                        <span className="tiny-muted">
                          {row.health.reason} · {row.connectedNumbers} number{row.connectedNumbers === 1 ? '' : 's'} ·{' '}
                          {formatRelativeDay(row.lastActivityAt)}
                        </span>
                      </div>
                    </td>
                    <td>{row.unreadMessages}</td>
                    <td>{row.appointmentsThisWeek}</td>
                    <td>{row.leadsThisWeek}</td>
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
