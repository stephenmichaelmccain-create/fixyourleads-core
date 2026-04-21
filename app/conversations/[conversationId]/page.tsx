import { db } from '@/lib/db';

export default async function ConversationDetailPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true, messages: { orderBy: { createdAt: 'asc' } } }
  });

  if (!conversation) {
    return <main style={{ fontFamily: 'sans-serif', padding: 24 }}>Conversation not found.</main>;
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Conversation Detail</h1>
      <p><strong>Conversation ID:</strong> {conversation.id}</p>
      <p><strong>Contact:</strong> {conversation.contact?.name || 'Unnamed'}</p>
      <p><strong>Phone:</strong> {conversation.contact?.phone}</p>
      <ul>
        {conversation.messages.map((message) => (
          <li key={message.id} style={{ marginBottom: 8 }}>
            <strong>{message.direction}:</strong> {message.content}
          </li>
        ))}
      </ul>
    </main>
  );
}
