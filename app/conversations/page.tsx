import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function ConversationsPage({ searchParams }: { searchParams?: Promise<{ companyId?: string }> }) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';
  const selectedCompany = companyId
    ? await safeLoad(
        () =>
          db.company.findUnique({
            where: { id: companyId },
            select: { id: true, name: true }
          }),
        null
      )
    : null;

  const conversations = companyId
    ? await safeLoad(
        () =>
          db.conversation.findMany({
            where: { companyId },
            include: { contact: true, messages: { orderBy: { createdAt: 'asc' } } },
            orderBy: { createdAt: 'desc' },
            take: 50
          }),
        []
      )
    : [];

  const queueConversations = [...conversations]
    .map((conversation) => {
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      const queueState = !lastMessage
        ? 'New thread'
        : lastMessage.direction === 'INBOUND'
          ? 'Needs reply'
          : 'Waiting on contact';
      const priority = !lastMessage ? 1 : lastMessage.direction === 'INBOUND' ? 0 : 2;
      const activityTime = lastMessage?.createdAt || conversation.createdAt;

      return {
        conversation,
        lastMessage,
        queueState,
        priority,
        activityTime
      };
    })
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return right.activityTime.getTime() - left.activityTime.getTime();
    });

  const nextConversation = queueConversations[0] || null;
  const needsReplyCount = queueConversations.filter((entry) => entry.queueState === 'Needs reply').length;
  const waitingCount = queueConversations.filter((entry) => entry.queueState === 'Waiting on contact').length;
  const newThreadCount = queueConversations.filter((entry) => entry.queueState === 'New thread').length;

  return (
    <LayoutShell
      title="Conversations"
      description="This is where the Fix Your Leads product becomes real: text threads tied to the right clinic, ready for fast replies, booking, and no duplicate chaos."
      companyId={companyId}
      companyName={selectedCompany?.name || undefined}
      section="conversations"
    >
      <CompanySelectorBar action="/conversations" initialCompanyId={companyId} />

      {!companyId && <div className="empty-state">Choose a company by name to load the conversation queue.</div>}

      {companyId && conversations.length === 0 && (
        <div className="empty-state">No conversations found yet, or the database is not ready for conversation queries.</div>
      )}

      {companyId && nextConversation && (
        <section className="panel panel-stack">
          <div className="metric-label">Work queue</div>
          <div className="inline-row justify-between">
            <div className="panel-stack">
              <h2 className="form-title">Start with the thread that needs the next human decision.</h2>
              <div className="inline-row text-muted">
                <span>Needs reply: {needsReplyCount}</span>
                <span>Waiting: {waitingCount}</span>
                <span>New: {newThreadCount}</span>
              </div>
            </div>
            <a className="button" href={`/conversations/${nextConversation.conversation.id}`}>
              Open next thread
            </a>
          </div>
        </section>
      )}

      <div className="record-grid">
        {queueConversations.map(({ conversation, lastMessage, queueState }) => (
          <section key={conversation.id} className="record-card">
            <div className="record-header">
              <div>
                <div className="metric-label">Conversation</div>
                <h2 className="record-title">
                  <a href={`/conversations/${conversation.id}`}>{conversation.contact?.name || 'Unnamed contact'}</a>
                </h2>
                <div className="record-subtitle">{conversation.contact?.phone || 'No phone'}</div>
              </div>
              <div className="panel-stack queue-card-meta">
                <span className={`status-chip queue-state-chip ${queueState === 'Needs reply' ? 'needs-attention' : ''}`}>
                  <strong>Queue</strong> {queueState}
                </span>
                <div className="tiny-muted">{lastMessage ? new Date(lastMessage.createdAt).toLocaleString() : 'No messages'}</div>
              </div>
            </div>

            <div className="record-subtitle">
              {lastMessage ? (
                <>
                  <strong>{lastMessage.direction}:</strong> {lastMessage.content}
                </>
              ) : (
                'No messages yet.'
              )}
            </div>

            <div className="record-links">
              <a className={queueState === 'Needs reply' ? 'button' : 'button-secondary'} href={`/conversations/${conversation.id}`}>
                Open thread
              </a>
              <span className="tiny-muted">
                {conversation.messages.length} message{conversation.messages.length === 1 ? '' : 's'}
              </span>
            </div>
          </section>
        ))}
      </div>
    </LayoutShell>
  );
}
