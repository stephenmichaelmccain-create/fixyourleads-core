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
    <LayoutShell title="Conversations" companyId={companyId}>
      <CompanySelectorBar action="/conversations" initialCompanyId={companyId} />

      {!companyId && <p>Enter a company ID to load conversations.</p>}

      {companyId && conversations.length === 0 && (
        <p style={{ color: '#666' }}>No conversations found yet, or the database is not ready for conversation queries.</p>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {conversations.map((conversation) => {
          const lastMessage = conversation.messages[conversation.messages.length - 1];
          return (
            <section
              key={conversation.id}
              style={{
                padding: 16,
                border: '1px solid #ddd',
                borderRadius: 12,
                background: '#fff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>
                    <a href={`/conversations/${conversation.id}`}>{conversation.contact?.name || 'Unnamed contact'}</a>
                  </h2>
                  <div style={{ color: '#555', marginTop: 4 }}>{conversation.contact?.phone || 'No phone'}</div>
                </div>
                <div style={{ color: '#777', fontSize: 12 }}>
                  {lastMessage ? new Date(lastMessage.createdAt).toLocaleString() : 'No messages'}
                </div>
              </div>

              <div style={{ marginTop: 12, color: '#333' }}>
                {lastMessage ? (
                  <>
                    <strong>{lastMessage.direction}:</strong> {lastMessage.content}
                  </>
                ) : (
                  'No messages yet.'
                )}
              </div>

              <div style={{ marginTop: 10, color: '#888', fontSize: 12 }}>
                {conversation.messages.length} message{conversation.messages.length === 1 ? '' : 's'}
              </div>
            </section>
          );
        })}
      </div>
    </LayoutShell>
  );
}
