import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { safeLoad } from '@/lib/ui-data';

export default async function ConversationDetailPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const conversation = await safeLoad(
    () =>
      db.conversation.findUnique({
        where: { id: conversationId },
        include: { contact: true, messages: { orderBy: { createdAt: 'asc' } } }
      }),
    null
  );

  if (!conversation) {
    return (
      <LayoutShell title="Conversation Detail">
        <p>Conversation not found.</p>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell title={conversation.contact?.name || 'Conversation'} companyId={conversation.companyId}>
      <div style={{ marginBottom: 20 }}>
        <div><strong>Phone:</strong> {conversation.contact?.phone || 'No phone'}</div>
        <div><strong>Conversation ID:</strong> {conversation.id}</div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 16,
          border: '1px solid #ddd',
          borderRadius: 12,
          background: '#fafafa'
        }}
      >
        {conversation.messages.length === 0 && <p>No messages yet.</p>}

        {conversation.messages.map((message) => {
          const outbound = message.direction === 'OUTBOUND';
          return (
            <div
              key={message.id}
              style={{
                alignSelf: outbound ? 'flex-end' : 'flex-start',
                maxWidth: '75%',
                background: outbound ? '#111' : '#e9e9eb',
                color: outbound ? '#fff' : '#111',
                padding: '10px 12px',
                borderRadius: 14
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                {message.direction} • {new Date(message.createdAt).toLocaleString()}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
            </div>
          );
        })}
      </div>
    </LayoutShell>
  );
}
