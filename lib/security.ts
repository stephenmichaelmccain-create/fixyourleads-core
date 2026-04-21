import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';

export const leadWebhookSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1).optional(),
  phone: z.string().min(7),
  source: z.string().min(1).optional(),
  sourceExternalId: z.string().min(1).optional()
});

export const telnyxWebhookSchema = z.object({
  companyId: z.string().min(1),
  messageId: z.string().min(1),
  from: z.string().min(7),
  text: z.string().min(1)
});

const telnyxPhoneSchema = z.object({
  phone_number: z.string().min(7),
  status: z.string().optional()
});

const telnyxErrorSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  title: z.string().optional(),
  detail: z.string().optional()
});

const telnyxRawEventSchema = z.object({
  data: z.object({
    event_type: z.string().min(1),
    id: z.string().min(1).optional(),
    occurred_at: z.string().optional(),
    payload: z.object({
      id: z.string().min(1).optional(),
      from: telnyxPhoneSchema.optional(),
      to: z.array(telnyxPhoneSchema).min(1),
      text: z.string().nullable().optional(),
      media: z.array(z.object({ url: z.string().optional(), content_type: z.string().optional() })).optional(),
      errors: z.array(telnyxErrorSchema).optional()
    })
  }),
  meta: z.object({
    attempt: z.number().int().positive().optional(),
    delivered_to: z.string().optional()
  }).optional()
});

export type NormalizedTelnyxWebhook =
  | {
      mode: 'simplified';
      eventType: 'message.received';
      eventId: string;
      companyId: string;
      messageId: string;
      from: string;
      to: null;
      text: string;
      occurredAt: null;
      deliveryStatus: null;
      errors: [];
      attempt: null;
      deliveredTo: null;
    }
  | {
      mode: 'raw';
      eventType: string;
      eventId: string;
      companyId: null;
      messageId: string;
      from: string | null;
      to: string;
      text: string | null;
      occurredAt: string | null;
      deliveryStatus: string | null;
      errors: Array<{ code?: string; title?: string; detail?: string }>;
      attempt: number | null;
      deliveredTo: string | null;
    };

type TelnyxSignatureVerificationResult =
  | { enabled: false; ok: true; reason: 'verification_disabled' }
  | { enabled: true; ok: true }
  | { enabled: true; ok: false; reason: string };

function truthyEnv(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function getTelnyxPublicKeyValue() {
  return String(process.env.TELNYX_PUBLIC_KEY || '').trim();
}

function getTelnyxTimestampToleranceSeconds() {
  const raw = Number(process.env.TELNYX_SIGNATURE_MAX_AGE_SECONDS || '300');
  return Number.isFinite(raw) && raw > 0 ? raw : 300;
}

function parseTelnyxPublicKey(publicKeyValue: string) {
  const normalized = publicKeyValue.replace(/\\n/g, '\n').trim();

  if (!normalized) {
    throw new Error('missing_public_key');
  }

  if (normalized.includes('BEGIN PUBLIC KEY')) {
    return createPublicKey(normalized);
  }

  const decoded = Buffer.from(normalized.replace(/\s+/g, ''), 'base64');

  if (!decoded.length) {
    throw new Error('invalid_public_key');
  }

  const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const derKey = decoded.length === 32 ? Buffer.concat([ed25519SpkiPrefix, decoded]) : decoded;

  return createPublicKey({
    key: derKey,
    format: 'der',
    type: 'spki'
  });
}

export function verifyTelnyxWebhookSignature(rawBody: string, signatureHeader?: string | null, timestampHeader?: string | null): TelnyxSignatureVerificationResult {
  if (!truthyEnv(process.env.TELNYX_VERIFY_SIGNATURES)) {
    return { enabled: false, ok: true, reason: 'verification_disabled' };
  }

  const publicKeyValue = getTelnyxPublicKeyValue();

  if (!publicKeyValue) {
    return { enabled: true, ok: false, reason: 'missing_TELNYX_PUBLIC_KEY' };
  }

  if (!signatureHeader || !timestampHeader) {
    return { enabled: true, ok: false, reason: 'missing_signature_headers' };
  }

  const timestamp = Number(timestampHeader);

  if (!Number.isFinite(timestamp)) {
    return { enabled: true, ok: false, reason: 'invalid_signature_timestamp' };
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);

  if (ageSeconds > getTelnyxTimestampToleranceSeconds()) {
    return { enabled: true, ok: false, reason: 'stale_signature_timestamp' };
  }

  try {
    const publicKey = parseTelnyxPublicKey(publicKeyValue);
    const signature = Buffer.from(signatureHeader, 'base64');
    const signedPayload = Buffer.from(`${timestampHeader}|${rawBody}`);
    const ok = verify(null, signedPayload, publicKey, signature);

    return ok ? { enabled: true, ok: true } : { enabled: true, ok: false, reason: 'signature_mismatch' };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      reason: error instanceof Error ? error.message : 'signature_verification_failed'
    };
  }
}

export function normalizeTelnyxWebhook(body: unknown): NormalizedTelnyxWebhook | null {
  const simplified = telnyxWebhookSchema.safeParse(body);

  if (simplified.success) {
    return {
      mode: 'simplified',
      eventType: 'message.received',
      eventId: simplified.data.messageId,
      companyId: simplified.data.companyId,
      messageId: simplified.data.messageId,
      from: simplified.data.from,
      to: null,
      text: simplified.data.text,
      occurredAt: null,
      deliveryStatus: null,
      errors: [],
      attempt: null,
      deliveredTo: null
    };
  }

  const raw = telnyxRawEventSchema.safeParse(body);

  if (!raw.success) {
    return null;
  }

  const firstTo = raw.data.data.payload.to[0]?.phone_number || '';
  const firstStatus = raw.data.data.payload.to[0]?.status || null;
  const text = raw.data.data.payload.text?.trim();
  const media = raw.data.data.payload.media || [];
  const errors = (raw.data.data.payload.errors || []).map((error) => ({
    code: error.code == null ? undefined : String(error.code),
    title: error.title,
    detail: error.detail
  }));

  return {
    mode: 'raw',
    eventType: raw.data.data.event_type,
    eventId: raw.data.data.id || raw.data.data.payload.id || '',
    companyId: null,
    messageId: raw.data.data.payload.id || raw.data.data.id || '',
    from: raw.data.data.payload.from?.phone_number || null,
    to: firstTo,
    text: text || (media.length > 0 ? '[media message]' : null),
    occurredAt: raw.data.data.occurred_at || null,
    deliveryStatus: firstStatus,
    errors,
    attempt: raw.data.meta?.attempt ?? null,
    deliveredTo: raw.data.meta?.delivered_to || null
  };
}
