import { notFound } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { sendClientMessagingTestAction } from '@/app/clients/[id]/operator/actions';
import { sendConversationMessageAction } from '@/app/conversations/[conversationId]/actions';
import { db } from '@/lib/db';
import { buildLifecycleByMessageId, lifecycleForMessage } from '@/lib/message-lifecycle';
import { allInboundNumbers, companyPrimaryInboundNumber } from '@/lib/inbound-numbers';
import { normalizePhone } from '@/lib/phone';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  lab?: string;
  conversationId?: string;
}>;

function formatCompactDateTime(value: Date | string | null | undefined) {
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

function truncatePhone(value?: string | null) {
  if (!value) {
    return '—';
  }

  if (value.length <= 6) {
    return value;
  }

  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function buildClientHref(companyId: string, options: { lab?: string; conversationId?: string }) {
  const params = new URLSearchParams();

  if (options.lab) {
    params.set('lab', options.lab);
  }

  if (options.conversationId) {
    params.set('conversationId', options.conversationId);
  }

  const search = params.toString();
  return search ? `/clients/${companyId}/operator?${search}` : `/clients/${companyId}/operator`;
}

function describeCommsEvent(eventType: string, payload: Record<string, unknown>) {
  if (eventType === 'operator_messaging_test_failed') {
    const detail = typeof payload.detail === 'string' ? payload.detail : '';
    const error = typeof payload.error === 'string' ? payload.error : '';

    if (detail === 'telnyx_send_failed' && error) {
      return error;
    }

    if (detail === 'target_phone_invalid') {
      return 'Destination phone format was invalid.';
    }

    if (detail === 'sender_missing') {
      return 'No active Telnyx sender is configured for this client.';
    }

    return error || 'The terminal failed before Telnyx accepted the request.';
  }

  if (eventType === 'telnyx_message_delivery_failed') {
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const firstError =
      errors[0] && typeof errors[0] === 'object' && !Array.isArray(errors[0]) ? (errors[0] as Record<string, unknown>) : null;

    return (
      (typeof firstError?.detail === 'string' && firstError.detail) ||
      (typeof firstError?.title === 'string' && firstError.title) ||
      'Carrier delivery failed after Telnyx accepted the message.'
    );
  }

  if (eventType === 'telnyx_message_finalized') {
    const deliveryStatus = typeof payload.deliveryStatus === 'string' ? payload.deliveryStatus : '';
    return deliveryStatus ? `Finalized as ${deliveryStatus}.` : 'Carrier finalized the delivery event.';
  }

  if (eventType === 'telnyx_message_sent') {
    return 'Telnyx accepted the send and is waiting on carrier delivery.';
  }

  if (eventType === 'operator_messaging_test_sent') {
    return 'The terminal created a CRM message record and sent it to Telnyx.';
  }

  if (eventType === 'message_received') {
    return 'Inbound reply captured and attached to the client thread.';
  }

  return 'Recent messaging event recorded.';
}

export default async function ClientCommsLabPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParamShape;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};
  const lab = query.lab === 'voice' ? 'voice' : 'sms';

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          telnyxInboundNumber: true,
          telnyxInboundNumbers: {
            select: { number: true },
            orderBy: { createdAt: 'asc' }
          }
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [recentCommsEvents, recentClientConversations] = await Promise.all([
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            companyId: id,
            eventType: {
              in: [
                'operator_messaging_test_sent',
                'operator_messaging_test_failed',
                'message_received',
                'manual_message_sent',
                'telnyx_message_sent',
                'telnyx_message_finalized',
                'telnyx_message_delivery_failed',
                'telnyx_message_delivery_unconfirmed'
              ]
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            eventType: true,
            createdAt: true,
            payload: true
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.conversation.findMany({
          where: {
            companyId: id
          },
          include: {
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
                direction: true,
                externalId: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 25
        }),
      []
    )
  ]);

  const sortedClientConversations = [...recentClientConversations].sort((left, right) => {
    const leftTime = left.messages[0]?.createdAt?.getTime() || left.createdAt.getTime();
    const rightTime = right.messages[0]?.createdAt?.getTime() || right.createdAt.getTime();
    return rightTime - leftTime;
  });

  const selectedConversationId = query.conversationId || sortedClientConversations[0]?.id || '';
  const selectedConversation = selectedConversationId
    ? await safeLoad(
        () =>
          db.conversation.findUnique({
            where: { id: selectedConversationId },
            include: {
              contact: true,
              messages: {
                orderBy: { createdAt: 'asc' },
                take: 40
              }
            }
          }),
        null
      )
    : null;

  const selectedConversationLifecycleEvents = selectedConversation
    ? await safeLoad(
        () =>
          db.eventLog.findMany({
            where: {
              companyId: selectedConversation.companyId,
              eventType: {
                in: [
                  'telnyx_message_sent',
                  'telnyx_message_finalized',
                  'telnyx_message_delivery_failed',
                  'telnyx_message_delivery_unconfirmed'
                ]
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: {
              eventType: true,
              createdAt: true,
              payload: true
            }
          }),
        []
      )
    : [];

  const selectedLifecycleByMessageId = buildLifecycleByMessageId(selectedConversationLifecycleEvents);

  const sharedTelnyxSender = process.env.TELNYX_FROM_NUMBER?.trim() || null;
  const primaryRoutingNumber = companyPrimaryInboundNumber(company);
  const assignedRoutingNumbers = allInboundNumbers(company);
  const activeSenderNumber = primaryRoutingNumber || sharedTelnyxSender;
  const telnyxMode = primaryRoutingNumber
    ? 'dedicated'
    : sharedTelnyxSender
      ? 'shared'
      : 'missing';
  const telnyxTrustCopy =
    telnyxMode === 'dedicated'
      ? 'Replies should route back to this client cleanly.'
      : telnyxMode === 'shared'
        ? 'Outbound SMS is available, but replies are still on the shared fallback sender.'
        : 'Do not trust live SMS here until a shared sender or dedicated inbound number is configured.';
  const selectedThreadHref = selectedConversation
    ? `${buildClientHref(company.id, { lab, conversationId: selectedConversation.id })}#messages-feed`
    : buildClientHref(company.id, { lab });

  return (
    <LayoutShell
      title={company.name}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="profile" />

      <section id="comms-lab" className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Comms Lab</div>
            <h2 className="section-title">Launch tools for texting and voice.</h2>
            <div className="text-muted">
              Run a live programmable SMS test from this client workspace and keep voice staged here when we turn it on.
            </div>
          </div>
        </div>

        <div className="workspace-tab-row">
          <a
            className={`workspace-tab-link ${lab === 'sms' ? 'is-active' : ''}`}
            href={`${buildClientHref(company.id, { lab: 'sms' })}#comms-lab`}
          >
            SMS terminal
          </a>
          <a
            className={`workspace-tab-link ${lab === 'voice' ? 'is-active' : ''}`}
            href={`${buildClientHref(company.id, { lab: 'voice' })}#comms-lab`}
          >
            AI voice
          </a>
        </div>

        {lab === 'sms' ? (
          <div className="comms-lab-grid">
            <section id="sms-lab" className="panel panel-stack comms-lab-card">
              <div className="inline-row">
                <span className="status-chip">
                  <strong>Sender</strong> {activeSenderNumber || 'Missing'}
                </span>
                <span className={`status-chip ${telnyxMode === 'missing' ? 'status-chip-attention' : 'status-chip-muted'}`}>
                  <strong>Mode</strong> {telnyxMode === 'dedicated' ? 'Dedicated' : telnyxMode === 'shared' ? 'Shared fallback' : 'Unconfigured'}
                </span>
                <span
                  className={`status-chip ${
                    process.env.TELNYX_VERIFY_SIGNATURES === 'true' ? 'status-chip-muted' : 'status-chip-attention'
                  }`}
                >
                  <strong>Webhook verify</strong> {process.env.TELNYX_VERIFY_SIGNATURES === 'true' ? 'On' : 'Off'}
                </span>
              </div>

              <div className="key-value-grid">
                <div className="key-value-card">
                  <span className="key-value-label">Webhook URL</span>
                  {process.env.APP_BASE_URL?.trim()
                    ? `${process.env.APP_BASE_URL.trim().replace(/\/$/, '')}/api/webhooks/telnyx`
                    : 'APP_BASE_URL missing'}
                </div>
                <div className="key-value-card">
                  <span className="key-value-label">Assigned lines</span>
                  {assignedRoutingNumbers.length > 0 ? assignedRoutingNumbers.join(', ') : 'No dedicated numbers assigned'}
                </div>
                <div className="key-value-card">
                  <span className="key-value-label">Reply path</span>
                  {telnyxTrustCopy}
                </div>
              </div>

              <form action={sendClientMessagingTestAction} className="panel-stack">
                <input type="hidden" name="companyId" value={company.id} />
                <input type="hidden" name="returnTo" value={buildClientHref(company.id, { lab })} />
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="client-messaging-test-phone">
                      Destination phone
                    </label>
                    <input
                      id="client-messaging-test-phone"
                      className="text-input"
                      name="targetPhone"
                      defaultValue={selectedConversation?.contact?.phone || sortedClientConversations[0]?.contact.phone || ''}
                      placeholder="+14155551234"
                    />
                  </div>
                </div>
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="client-messaging-test-text">
                    Test message
                  </label>
                  <textarea
                    id="client-messaging-test-text"
                    name="text"
                    className="text-area comms-terminal-text"
                    rows={5}
                    defaultValue={`Hi, this is a live Fix Your Leads SMS test for ${company.name}. Reply to this message so we can verify routing and thread capture.`}
                  />
                </div>
                <div className="inline-actions inline-actions-wrap">
                  <button type="submit" className="button-secondary">
                    Send live SMS test
                  </button>
                  <span className="tiny-muted">
                    Sends through the client&apos;s active Telnyx line and records the result in events.
                  </span>
                </div>
              </form>
            </section>

            <section className="panel panel-stack comms-lab-card">
              <div className="metric-label">Recent messaging activity</div>
              {recentCommsEvents.length === 0 ? (
                <div className="empty-state">No SMS activity logged for this client yet.</div>
              ) : (
                <div className="status-list">
                  {recentCommsEvents.map((event, index) => {
                    const payload =
                      event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
                        ? (event.payload as Record<string, unknown>)
                        : {};
                    const tone =
                      event.eventType.includes('failed')
                        ? 'error'
                        : event.eventType.includes('unconfirmed')
                          ? 'warn'
                          : 'ok';
                    const label =
                      event.eventType === 'operator_messaging_test_sent'
                        ? 'Terminal test sent'
                        : event.eventType === 'operator_messaging_test_failed'
                          ? 'Terminal test failed'
                          : event.eventType === 'message_received'
                            ? 'Inbound reply received'
                            : event.eventType === 'manual_message_sent'
                              ? 'Operator message sent'
                              : event.eventType === 'telnyx_message_sent'
                                ? 'Telnyx accepted send'
                                : event.eventType === 'telnyx_message_finalized'
                                  ? 'Telnyx finalized send'
                                  : event.eventType === 'telnyx_message_delivery_failed'
                                    ? 'Delivery failed'
                                    : 'Delivery unconfirmed';
                    const target =
                      typeof payload.targetPhone === 'string'
                        ? payload.targetPhone
                        : typeof payload.to === 'string'
                          ? payload.to
                          : typeof payload.from === 'string'
                            ? payload.from
                            : null;

                    return (
                      <div key={`${event.eventType}-${event.createdAt.toISOString()}-${index}`} className="status-item">
                        <div className="panel-stack">
                          <div className="inline-row">
                            <span className={`status-dot ${tone}`} />
                            <strong>{label}</strong>
                          </div>
                          <div className="tiny-muted">
                            {target ? `${target} • ` : ''}
                            {formatCompactDateTime(event.createdAt)}
                          </div>
                          <div className="tiny-muted">{describeCommsEvent(event.eventType, payload)}</div>
                        </div>
                        <span className="status-chip status-chip-muted">{event.eventType}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div id="voice-lab" className="comms-lab-grid">
            <section className="panel panel-stack comms-lab-card">
              <div className="inline-row">
                <span className="status-chip">
                  <strong>AI voice</strong> Webhook ready
                </span>
              </div>
              <h3 className="section-title">Voice booking is ready for provider wiring.</h3>
              <div className="text-muted">
                Keep this in the same client workspace so SMS and voice live together when we switch on AI calls.
              </div>
              <ul className="list-clean tiny-muted">
                <li>Route test calls through the client&apos;s assigned line.</li>
                <li>Post bookings to the voice webhook saved in Workflow.</li>
                <li>Capture recording, transcript, and booking handoff on the Meetings board.</li>
              </ul>
              <div className="tiny-muted">
                Use the exact webhook URL shown in Workflow. The booking payload must include `phone` and `startTime`, then
                either `companyId`, `telnyxAssistantId`, or `calledNumber` so the booking lands on the right client.
              </div>
            </section>

            <section className="panel panel-stack comms-lab-card">
              <div className="metric-label">Voice readiness</div>
              <div className="key-value-grid">
                <div className="key-value-card">
                  <span className="key-value-label">Assigned line</span>
                  {activeSenderNumber || 'Missing'}
                </div>
                <div className="key-value-card">
                  <span className="key-value-label">Status</span>
                  Waiting on live provider booking events
                </div>
                <div className="key-value-card">
                  <span className="key-value-label">Next step</span>
                  Point Telnyx at the workflow voice webhook and run a live booking test
                </div>
              </div>
            </section>
          </div>
        )}
      </section>

      <section id="messages-feed" className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Messages feed</div>
            <h2 className="section-title">Client conversation history.</h2>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Last message preview</th>
                <th>When</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedClientConversations.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">No conversations exist for this client yet.</div>
                  </td>
                </tr>
              ) : (
                sortedClientConversations.map((conversation) => {
                  const latestMessage = conversation.messages[0] || null;
                  const needsReply = latestMessage?.direction === 'INBOUND';
                  const conversationHref = `${buildClientHref(company.id, { lab, conversationId: conversation.id })}#messages-feed`;

                  return (
                    <tr key={conversation.id}>
                      <td>
                        <a className="table-link" href={conversationHref}>
                          {conversation.contact.name || truncatePhone(conversation.contact.phone)}
                        </a>
                      </td>
                      <td>
                        <a className="table-link" href={conversationHref}>
                          {latestMessage?.content?.slice(0, 100) || 'No messages yet'}
                        </a>
                      </td>
                      <td>{formatCompactDateTime(latestMessage?.createdAt || conversation.createdAt)}</td>
                      <td>
                        <span className={`status-chip ${needsReply ? 'status-chip-attention' : 'status-chip-muted'}`}>
                          <span className={`status-dot ${needsReply ? 'error' : 'ok'}`} />
                          {needsReply ? 'Needs reply' : 'Handled'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {selectedConversation ? (
          (() => {
            const threadPhone = normalizePhone(selectedConversation.contact?.phone || '');

            return (
              <section className="panel panel-stack">
                <div className="record-header">
                  <div className="panel-stack">
                    <h3 className="section-title">{selectedConversation.contact?.name || 'Conversation'}</h3>
                    <div className="tiny-muted">
                      {selectedConversation.contact?.phone || 'No phone'}
                    </div>
                  </div>
                  <div className="inline-actions">
                    <a className="button-ghost" href={`/conversations/${selectedConversation.id}`}>
                      Full thread
                    </a>
                  </div>
                </div>

                <div className="message-thread">
                  {selectedConversation.messages.length === 0 ? (
                    <div className="empty-state">No messages yet.</div>
                  ) : (
                    selectedConversation.messages.map((message) => {
                      const lifecycle = lifecycleForMessage(
                        message,
                        selectedLifecycleByMessageId.get(message.id) || []
                      );

                      return (
                        <div key={message.id} className={`message-row${message.direction === 'OUTBOUND' ? ' outbound' : ''}`}>
                          <div className={`message-bubble${message.direction === 'OUTBOUND' ? ' outbound' : ''}`}>
                            <div className="message-meta" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                              <span>
                                {message.direction} • {formatCompactDateTime(message.createdAt)}
                              </span>
                              <span
                                className={`status-chip ${
                                  lifecycle.tone === 'error'
                                    ? 'status-chip-attention'
                                    : lifecycle.tone === 'warn' || lifecycle.tone === 'muted'
                                      ? 'status-chip-muted'
                                      : ''
                                }`}
                              >
                                <span
                                  className={`status-dot ${
                                    lifecycle.tone === 'error'
                                      ? 'error'
                                      : lifecycle.tone === 'warn'
                                        ? 'warn'
                                        : lifecycle.tone === 'muted'
                                          ? 'warn'
                                          : 'ok'
                                  }`}
                                />
                                {lifecycle.label}
                              </span>
                            </div>
                            <div className="pre-wrap">{message.content}</div>
                            <div className="tiny-muted">{lifecycle.detail}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form action={sendConversationMessageAction} className="panel-stack">
                  <input type="hidden" name="companyId" value={selectedConversation.companyId} />
                  <input type="hidden" name="contactId" value={selectedConversation.contactId} />
                  <input type="hidden" name="conversationId" value={selectedConversation.id} />
                  <input type="hidden" name="returnTo" value={selectedThreadHref} />
                  <textarea
                    name="text"
                    placeholder="Write the next outbound text"
                    className="text-area"
                    rows={3}
                  />
                  <div className="inline-actions inline-actions-wrap">
                    <button type="submit" className="button-secondary">
                      Send text
                    </button>
                    {threadPhone ? (
                      <a className="button-ghost" href={`sms:${threadPhone}`}>
                        Open SMS
                      </a>
                    ) : null}
                  </div>
                </form>
              </section>
            );
          })()
        ) : null}
      </section>
    </LayoutShell>
  );
}
