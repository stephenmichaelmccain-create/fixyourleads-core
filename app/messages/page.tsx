import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  filter?: string;
}>;

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
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

function buildMessagesHref(filter?: string) {
  return filter && filter !== 'all' ? `/messages?filter=${encodeURIComponent(filter)}` : '/messages';
}

export default async function MessagesPage({
  searchParams
}: {
  searchParams?: SearchParamShape;
}) {
  const params = (await searchParams) || {};
  const selectedFilter = ['all', 'needs_human', 'today'].includes(String(params.filter || ''))
    ? String(params.filter)
    : 'all';
  const todayStart = startOfDay();

  const rows = await safeLoad(
    () =>
      db.conversation.findMany({
        include: {
          company: {
            select: {
              id: true,
              name: true
            }
          },
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
              id: true,
              content: true,
              createdAt: true,
              direction: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
    []
  );

  const visibleRows = rows
    .filter((row) => !isLikelyTestWorkspaceName(row.company.name))
    .map((row) => {
      const latestMessage = row.messages[0] || null;
      const needsHuman = latestMessage?.direction === 'INBOUND';
      const happenedToday = latestMessage ? latestMessage.createdAt >= todayStart : false;

      return {
        ...row,
        latestMessage,
        needsHuman,
        happenedToday
      };
    })
    .filter((row) => {
      if (selectedFilter === 'needs_human') {
        return row.needsHuman;
      }

      if (selectedFilter === 'today') {
        return row.happenedToday;
      }

      return true;
    })
    .sort((left, right) => {
      const leftTime = left.latestMessage?.createdAt?.getTime() || 0;
      const rightTime = right.latestMessage?.createdAt?.getTime() || 0;
      return rightTime - leftTime;
    });

  return (
    <LayoutShell
      title="Messages"
      description="One inbox across all clients. Open the rows that need a human and leave the healthy AI threads alone."
      section="messages"
    >
      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Unified inbox</div>
            <h2 className="section-title">Check the latest client conversations in one place.</h2>
          </div>
          <div className="inline-actions">
            <a className={selectedFilter === 'all' ? 'button' : 'button-secondary'} href={buildMessagesHref('all')}>
              All
            </a>
            <a className={selectedFilter === 'needs_human' ? 'button' : 'button-secondary'} href={buildMessagesHref('needs_human')}>
              Needs Human
            </a>
            <a className={selectedFilter === 'today' ? 'button' : 'button-secondary'} href={buildMessagesHref('today')}>
              Today
            </a>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Lead Name</th>
                <th>Last Message Preview</th>
                <th>When</th>
                <th>AI / Needs Human</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">No conversations match this inbox view right now.</div>
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <a className="table-link" href={`/clients/${row.company.id}`}>
                        {row.company.name}
                      </a>
                    </td>
                    <td>{row.contact.name || row.contact.phone || 'Unknown lead'}</td>
                    <td>
                      <a className="table-link" href={`/conversations/${row.id}`}>
                        {row.latestMessage?.content?.slice(0, 90) || 'No messages yet'}
                      </a>
                    </td>
                    <td>{formatDateTime(row.latestMessage?.createdAt)}</td>
                    <td>
                      <span className={`status-chip ${row.needsHuman ? 'status-chip-attention' : 'status-chip-muted'}`}>
                        <span className={`status-dot ${row.needsHuman ? 'error' : 'ok'}`} />
                        {row.needsHuman ? 'Needs Human' : 'AI'}
                      </span>
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
