import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function ConversationsPage({ searchParams }: { searchParams?: Promise<{ companyId?: string }> }) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';

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

  return (
    <LayoutShell
      title="Conversations"
      description="This is where the Fix Your Leads product becomes real: text threads tied to the right clinic, ready for fast replies, booking, and no duplicate chaos."
      companyId={companyId}
      section="conversations"
    >
      <CompanySelectorBar action="/conversations" initialCompanyId={companyId} />

      {!companyId && <div className="empty-state">Enter a company ID to load conversations.</div>}

      {companyId && conversations.length === 0 && (
        <div className="empty-state">No conversations found yet, or the database is not ready for conversation queries.</div>
      )}

      <div className="record-grid">
        {conversations.map((conversation) => {
          const lastMessage = conversation.messages[conversation.messages.length - 1];
          return (
            <section key={conversation.id} className="record-card">
              <div className="record-header">
                <div>
                  <div className="metric-label">Conversation</div>
                  <h2 className="record-title">
                    <a href={`/conversations/${conversation.id}`}>{conversation.contact?.name || 'Unnamed contact'}</a>
                  </h2>
                  <div className="record-subtitle">{conversation.contact?.phone || 'No phone'}</div>
                </div>
                <div className="tiny-muted">
                  {lastMessage ? new Date(lastMessage.createdAt).toLocaleString() : 'No messages'}
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
                <a className="button-secondary" href={`/conversations/${conversation.id}`}>
                  Open thread
                </a>
                <span className="tiny-muted">
                {conversation.messages.length} message{conversation.messages.length === 1 ? '' : 's'}
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </LayoutShell>
  );
}
