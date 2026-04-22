type LifecycleEvent = {
  eventType: string;
  createdAt: Date;
  payload: unknown;
};

type LifecycleMessage = {
  direction: 'INBOUND' | 'OUTBOUND';
  externalId: string | null;
  createdAt: Date;
};

export type MessageLifecycleState = {
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'muted';
  detail: string;
};

export type ConversationRoutingObservation = {
  inboundNumber: string | null;
  outboundNumber: string | null;
};

function formatLifecycleTime(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(value);
}

export function readPayloadRecord(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  return payload as Record<string, unknown>;
}

export function buildLifecycleByMessageId(events: LifecycleEvent[]) {
  const lifecycleByMessageId = new Map<string, Array<{
    eventType: string;
    createdAt: Date;
    payload: Record<string, unknown> | null;
  }>>();

  for (const event of events) {
    const payload = readPayloadRecord(event.payload);
    const internalMessageId = typeof payload?.internalMessageId === 'string' ? payload.internalMessageId : null;

    if (!internalMessageId) {
      continue;
    }

    const existing = lifecycleByMessageId.get(internalMessageId) || [];
    existing.push({
      eventType: event.eventType,
      createdAt: event.createdAt,
      payload
    });
    lifecycleByMessageId.set(internalMessageId, existing);
  }

  return lifecycleByMessageId;
}

export function buildConversationRoutingObservation(
  events: LifecycleEvent[],
  conversationId: string
): ConversationRoutingObservation {
  const observation: ConversationRoutingObservation = {
    inboundNumber: null,
    outboundNumber: null
  };

  for (const event of events) {
    const payload = readPayloadRecord(event.payload);
    const payloadConversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : null;

    if (payloadConversationId !== conversationId) {
      continue;
    }

    if (!observation.inboundNumber && event.eventType === 'message_received') {
      const observedInbound = typeof payload?.to === 'string' ? payload.to : null;
      if (observedInbound) {
        observation.inboundNumber = observedInbound;
      }
    }

    if (!observation.outboundNumber) {
      const observedOutbound = typeof payload?.from === 'string' ? payload.from : null;
      if (
        observedOutbound &&
        (event.eventType === 'manual_message_sent' ||
          event.eventType === 'telnyx_message_sent' ||
          event.eventType === 'telnyx_message_finalized' ||
          event.eventType === 'telnyx_message_delivery_failed' ||
          event.eventType === 'telnyx_message_delivery_unconfirmed')
      ) {
        observation.outboundNumber = observedOutbound;
      }
    }

    if (observation.inboundNumber && observation.outboundNumber) {
      break;
    }
  }

  return observation;
}

function parseLifecycleAttempt(value: unknown) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function lifecycleForMessage(message: LifecycleMessage, lifecycleEvents: LifecycleEvent[]): MessageLifecycleState {
  if (message.direction === 'INBOUND') {
    return {
      label: 'Received',
      tone: 'ok',
      detail: 'Inbound message captured from Telnyx.'
    };
  }

  const latestFailure = lifecycleEvents.find((event) => event.eventType === 'telnyx_message_delivery_failed');

  if (latestFailure) {
    const failurePayload = readPayloadRecord(latestFailure.payload);
    const errors = Array.isArray(failurePayload?.errors) ? failurePayload.errors : [];
    const firstError =
      errors[0] && typeof errors[0] === 'object' && !Array.isArray(errors[0]) ? (errors[0] as Record<string, unknown>) : null;
    const errorDetail =
      (typeof firstError?.detail === 'string' && firstError.detail) ||
      (typeof firstError?.title === 'string' && firstError.title) ||
      'Telnyx reported a delivery failure.';

    return {
      label: 'Delivery failed',
      tone: 'error',
      detail: errorDetail
    };
  }

  const latestUnconfirmed = lifecycleEvents.find((event) => event.eventType === 'telnyx_message_delivery_unconfirmed');

  if (latestUnconfirmed) {
    return {
      label: 'Delivery unconfirmed',
      tone: 'warn',
      detail: 'Telnyx could not confirm delivery yet.'
    };
  }

  const latestFinalized = lifecycleEvents.find((event) => event.eventType === 'telnyx_message_finalized');

  if (latestFinalized) {
    const finalizedPayload = readPayloadRecord(latestFinalized.payload);
    const deliveryStatus = typeof finalizedPayload?.deliveryStatus === 'string' ? finalizedPayload.deliveryStatus : null;

    return {
      label: 'Delivered',
      tone: 'ok',
      detail: deliveryStatus ? `Telnyx finalized this message as ${deliveryStatus}.` : 'Telnyx finalized delivery.'
    };
  }

  const latestSent = lifecycleEvents.find((event) => event.eventType === 'telnyx_message_sent');
  const latestAttempt = lifecycleEvents
    .map((event) => parseLifecycleAttempt(readPayloadRecord(event.payload)?.attempt))
    .find((value) => typeof value === 'number');

  if (latestSent || message.externalId) {
    return {
      label: 'Accepted',
      tone: 'ok',
      detail: latestAttempt ? `Accepted by Telnyx on attempt ${latestAttempt}.` : 'Accepted by Telnyx and waiting on delivery updates.'
    };
  }

  return {
    label: 'Logged',
    tone: 'muted',
    detail: `Stored in CRM at ${formatLifecycleTime(message.createdAt)}.`
  };
}
