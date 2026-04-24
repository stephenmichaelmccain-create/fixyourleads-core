import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  filter?: string;
}>;

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

function buildClientThreadHref(companyId: string, conversationId: string) {
  return `/clients/${companyId}/operator?conversationId=${encodeURIComponent(conversationId)}`;
}

export default async function MessagesPage({
  searchParams
}: {
  searchParams?: SearchParamShape;
}) {
  const params = (await searchParams) || {};
  const selectedFilter = ['all', 'needs_human'].includes(String(params.filter || ''))
    ? String(params.filter)
    : 'needs_human';

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

      return {
        ...row,
        latestMessage,
        needsHuman
      };
    })
    .filter((row) => {
      if (selectedFilter === 'needs_human') {
        return row.needsHuman;
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
      section="messages"
    >
      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Global inbox</div>
          </div>
          <div className="inline-actions">
            <a className={selectedFilter === 'all' ? 'button-secondary' : 'button-ghost'} href={buildMessagesHref('all')}>
              All
            </a>
            <a className={selectedFilter === 'needs_human' ? 'button' : 'button-secondary'} href={buildMessagesHref('needs_human')}>
              Needs reply
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
                <th>Status</th>
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
                      <a className="table-link" href={buildClientThreadHref(row.company.id, row.id)}>
                        {row.company.name}
                      </a>
                    </td>
                    <td>{row.contact.name || row.contact.phone || 'Unknown lead'}</td>
                    <td>
                      <a className="table-link" href={buildClientThreadHref(row.company.id, row.id)}>
                        {row.latestMessage?.content?.slice(0, 90) || 'No messages yet'}
                      </a>
                    </td>
                    <td>{formatDateTime(row.latestMessage?.createdAt)}</td>
                    <td>
                      <span className={`status-chip ${row.needsHuman ? 'status-chip-attention' : 'status-chip-muted'}`}>
                        <span className={`status-dot ${row.needsHuman ? 'error' : 'ok'}`} />
                        {row.needsHuman ? 'Needs reply' : 'Handled'}
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
