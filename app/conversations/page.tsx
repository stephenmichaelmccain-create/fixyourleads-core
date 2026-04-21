import { db } from '@/lib/db';

export default async function ConversationsPage({ searchParams }: { searchParams?: Promise<{ companyId?: string }> }) {
  const params = (await searchParams) || {};
  const companyId = params.companyId;

  const conversations = companyId
    ? await db.conversation.findMany({
        where: { companyId },
        include: { contact: true, messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      })
    : [];

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Conversations</h1>
      <p>Pass <code>?companyId=...</code> in the URL.</p>
      {conversations.map((conversation) => (
        <section key={conversation.id} style={{ marginBottom: 24, paddingBottom: 12, borderBottom: '1px solid #ddd' }}>
          <h2 style={{ marginBottom: 6 }}>{conversation.contact?.name || 'Unnamed contact'}</h2>
          <div style={{ marginBottom: 8 }}>{conversation.contact?.phone}</div>
          <ul>
            {conversation.messages.map((message) => (
              <li key={message.id}>
                <strong>{message.direction}:</strong> {message.content}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
