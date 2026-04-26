import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { authenticateVoiceWebhookRequest } from '../lib/voice-webhook-auth';

const originalVerify = process.env.TELNYX_VERIFY_SIGNATURES;
const originalPublicKey = process.env.TELNYX_PUBLIC_KEY;
const originalMaxAge = process.env.TELNYX_SIGNATURE_MAX_AGE_SECONDS;
const originalBookingSecret = process.env.VOICE_BOOKING_WEBHOOK_SECRET;
const originalDemoSecret = process.env.VOICE_DEMO_WEBHOOK_SECRET;
const originalInternalApiKey = process.env.INTERNAL_API_KEY;

afterEach(() => {
  process.env.TELNYX_VERIFY_SIGNATURES = originalVerify;
  process.env.TELNYX_PUBLIC_KEY = originalPublicKey;
  process.env.TELNYX_SIGNATURE_MAX_AGE_SECONDS = originalMaxAge;
  process.env.VOICE_BOOKING_WEBHOOK_SECRET = originalBookingSecret;
  process.env.VOICE_DEMO_WEBHOOK_SECRET = originalDemoSecret;
  process.env.INTERNAL_API_KEY = originalInternalApiKey;
});

describe('voice webhook auth', () => {
  it('accepts unsigned requests when the shared secret matches', () => {
    process.env.TELNYX_VERIFY_SIGNATURES = 'true';
    delete process.env.TELNYX_PUBLIC_KEY;
    process.env.VOICE_BOOKING_WEBHOOK_SECRET = 'booking-secret';

    const headers = new Headers({
      'x-voice-webhook-secret': 'booking-secret'
    });

    expect(authenticateVoiceWebhookRequest('{"phone":"+15555550199"}', headers)).toEqual({
      ok: true
    });
  });

  it('falls back to INTERNAL_API_KEY when no dedicated voice secret is configured', () => {
    process.env.TELNYX_VERIFY_SIGNATURES = 'true';
    delete process.env.TELNYX_PUBLIC_KEY;
    delete process.env.VOICE_BOOKING_WEBHOOK_SECRET;
    delete process.env.VOICE_DEMO_WEBHOOK_SECRET;
    process.env.INTERNAL_API_KEY = 'internal-secret';

    const headers = new Headers({
      'x-voice-webhook-secret': 'internal-secret'
    });

    expect(authenticateVoiceWebhookRequest('{"phone":"+15555550199"}', headers)).toEqual({
      ok: true
    });
  });

  it('rejects unsigned requests when no shared secret is configured', () => {
    process.env.TELNYX_VERIFY_SIGNATURES = 'true';
    delete process.env.TELNYX_PUBLIC_KEY;
    delete process.env.VOICE_BOOKING_WEBHOOK_SECRET;
    delete process.env.VOICE_DEMO_WEBHOOK_SECRET;
    delete process.env.INTERNAL_API_KEY;

    expect(authenticateVoiceWebhookRequest('{}', new Headers())).toEqual({
      ok: false,
      error: 'unauthorized',
      reason: 'missing_webhook_secret'
    });
  });

  it('still rejects partial or malformed signed requests', () => {
    process.env.TELNYX_VERIFY_SIGNATURES = 'true';
    process.env.TELNYX_PUBLIC_KEY = 'bogus';
    process.env.VOICE_BOOKING_WEBHOOK_SECRET = 'booking-secret';

    const headers = new Headers({
      'x-voice-webhook-secret': 'booking-secret',
      'telnyx-signature-ed25519': 'present-without-timestamp'
    });

    expect(authenticateVoiceWebhookRequest('{}', headers)).toEqual({
      ok: false,
      error: 'invalid_signature',
      reason: 'missing_signature_headers'
    });
  });

  it('accepts valid signed requests and still honors the shared secret when configured', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    process.env.TELNYX_VERIFY_SIGNATURES = 'true';
    process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.TELNYX_SIGNATURE_MAX_AGE_SECONDS = '300';
    process.env.VOICE_BOOKING_WEBHOOK_SECRET = 'booking-secret';

    const rawBody = JSON.stringify({ phone: '+15555550199' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString('base64');
    const headers = new Headers({
      authorization: 'Bearer booking-secret',
      'telnyx-signature-ed25519': signature,
      'telnyx-timestamp': timestamp
    });

    expect(authenticateVoiceWebhookRequest(rawBody, headers)).toEqual({
      ok: true
    });
  });
});
