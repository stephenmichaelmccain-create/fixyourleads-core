import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { safeLoad } from '@/lib/ui-data';
import { bookConversationAction, sendConversationMessageAction } from './actions';

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
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
          marginBottom: 20
        }}
      >
        <form
          action={sendConversationMessageAction}
          style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16, display: 'grid', gap: 10 }}
        >
          <strong>Send outbound message</strong>
          <input type="hidden" name="companyId" value={conversation.companyId} />
          <input type="hidden" name="contactId" value={conversation.contactId} />
          <input type="hidden" name="conversationId" value={conversation.id} />
          <textarea
            name="text"
            rows={4}
            placeholder="Write the next outbound text"
            style={{ padding: 10, resize: 'vertical' }}
          />
          <button type="submit" style={{ width: 'fit-content', padding: '8px 12px', cursor: 'pointer' }}>
            Send text
          </button>
        </form>

        <form
          action={bookConversationAction}
          style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16, display: 'grid', gap: 10 }}
        >
          <strong>Book appointment</strong>
          <input type="hidden" name="companyId" value={conversation.companyId} />
          <input type="hidden" name="contactId" value={conversation.contactId} />
          <input type="hidden" name="conversationId" value={conversation.id} />
          <input type="datetime-local" name="startTime" style={{ padding: 10 }} />
          <div style={{ color: '#666', fontSize: 13 }}>
            If the company has a notification email configured and SMTP is set, booking will notify the client automatically.
          </div>
          <button type="submit" style={{ width: 'fit-content', padding: '8px 12px', cursor: 'pointer' }}>
            Book and notify
          </button>
        </form>
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
