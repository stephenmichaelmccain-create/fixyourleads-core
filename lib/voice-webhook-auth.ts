import { verifyTelnyxWebhookSignature } from './security';

export type VoiceWebhookAuthResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: 'invalid_signature' | 'unauthorized';
      reason?: string;
    };

function configuredWebhookSecret() {
  const secret =
    process.env.VOICE_BOOKING_WEBHOOK_SECRET?.trim() ||
    process.env.VOICE_DEMO_WEBHOOK_SECRET?.trim();

  return secret || null;
}

function matchingWebhookSecret(headers: Headers, secret: string) {
  const authorization = headers.get('authorization') || '';
  const bearer = authorization.replace(/^Bearer\s+/i, '').trim();
  const headerSecret =
    headers.get('x-webhook-secret') || headers.get('x-voice-webhook-secret') || '';

  return bearer === secret || headerSecret === secret;
}

export function hasTelnyxSignatureHeaders(headers: Headers) {
  return Boolean(headers.get('telnyx-signature-ed25519') || headers.get('telnyx-timestamp'));
}

export function authenticateVoiceWebhookRequest(rawBody: string, headers: Headers): VoiceWebhookAuthResult {
  const secret = configuredWebhookSecret();
  const signatureHeader = headers.get('telnyx-signature-ed25519');
  const timestampHeader = headers.get('telnyx-timestamp');

  if (hasTelnyxSignatureHeaders(headers)) {
    const signatureResult = verifyTelnyxWebhookSignature(rawBody, signatureHeader, timestampHeader);

    if (!signatureResult.ok) {
      return {
        ok: false,
        error: 'invalid_signature',
        reason: signatureResult.reason
      };
    }

    if (!secret) {
      return { ok: true };
    }

    return matchingWebhookSecret(headers, secret)
      ? { ok: true }
      : { ok: false, error: 'unauthorized', reason: 'invalid_webhook_secret' };
  }

  if (!secret) {
    return {
      ok: false,
      error: 'unauthorized',
      reason: 'missing_webhook_secret'
    };
  }

  return matchingWebhookSecret(headers, secret)
    ? { ok: true }
    : { ok: false, error: 'unauthorized', reason: 'invalid_webhook_secret' };
}
