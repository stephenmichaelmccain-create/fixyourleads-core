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
      <LayoutShell title="Conversation Detail" description="The requested conversation could not be found." section="conversations">
        <div className="empty-state">Conversation not found.</div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell
      title={conversation.contact?.name || 'Conversation'}
      description="Review the full thread, send the next message, and book the appointment from the same screen."
      companyId={conversation.companyId}
      section="conversations"
    >
      <div className="key-value-grid">
        <div className="key-value-card">
          <span className="key-value-label">Phone</span>
          {conversation.contact?.phone || 'No phone'}
        </div>
        <div className="key-value-card">
          <span className="key-value-label">Conversation ID</span>
          <span className="tiny-muted">{conversation.id}</span>
        </div>
      </div>

      <div className="actions-grid">
        <form
          action={sendConversationMessageAction}
          className="panel panel-stack"
        >
          <div className="metric-label">Outbound SMS</div>
          <h2 className="form-title">Send the next text</h2>
          <input type="hidden" name="companyId" value={conversation.companyId} />
          <input type="hidden" name="contactId" value={conversation.contactId} />
          <input type="hidden" name="conversationId" value={conversation.id} />
          <textarea
            name="text"
            placeholder="Write the next outbound text"
            className="text-area"
          />
          <button type="submit" className="button">
            Send text
          </button>
        </form>

        <form
          action={bookConversationAction}
          className="panel panel-stack"
        >
          <div className="metric-label">Booking</div>
          <h2 className="form-title">Book the appointment</h2>
          <input type="hidden" name="companyId" value={conversation.companyId} />
          <input type="hidden" name="contactId" value={conversation.contactId} />
          <input type="hidden" name="conversationId" value={conversation.id} />
          <input type="datetime-local" name="startTime" className="text-input" />
          <div className="text-muted">
            If the company has a notification email configured and SMTP is set, booking will notify the client automatically.
          </div>
          <button type="submit" className="button-secondary">
            Book and notify
          </button>
        </form>
      </div>

      <div className="message-thread">
        {conversation.messages.length === 0 && <div className="empty-state">No messages yet.</div>}

        {conversation.messages.map((message) => {
          const outbound = message.direction === 'OUTBOUND';
          return (
            <div key={message.id} className={`message-row${outbound ? ' outbound' : ''}`}>
              <div className={`message-bubble${outbound ? ' outbound' : ''}`}>
                <div className="message-meta">
                  {message.direction} • {new Date(message.createdAt).toLocaleString()}
                </div>
                <div className="pre-wrap">{message.content}</div>
              </div>
            </div>
          );
        })}
      </div>
    </LayoutShell>
  );
}
