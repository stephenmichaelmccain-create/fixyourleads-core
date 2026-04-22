import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { getTelnyxWebhookSecurityConfig, verifyTelnyxWebhookSignature } from '../lib/security';

const originalVerify = process.env.TELNYX_VERIFY_SIGNATURES;
const originalPublicKey = process.env.TELNYX_PUBLIC_KEY;
const originalMaxAge = process.env.TELNYX_SIGNATURE_MAX_AGE_SECONDS;

afterEach(() => {
  process.env.TELNYX_VERIFY_SIGNATURES = originalVerify;
  process.env.TELNYX_PUBLIC_KEY = originalPublicKey;
  process.env.TELNYX_SIGNATURE_MAX_AGE_SECONDS = originalMaxAge;
});

describe('telnyx webhook security', () => {
  it('reports disabled verification when env flag is off', () => {
    delete process.env.TELNYX_VERIFY_SIGNATURES;
    delete process.env.TELNYX_PUBLIC_KEY;

    expect(getTelnyxWebhookSecurityConfig()).toEqual({
      verificationEnabled: false,
      publicKeySet: false,
      timestampToleranceSeconds: 300
    });

    expect(verifyTelnyxWebhookSignature('{}', null, null)).toMatchObject({
      enabled: false,
      ok: true,
      reason: 'verification_disabled'
    });
  });

  it('rejects when verification is on but no public key is set', () => {
    process.env.TELNYX_VERIFY_SIGNATURES = 'true';
    delete process.env.TELNYX_PUBLIC_KEY;

    expect(verifyTelnyxWebhookSignature('{}', 'abc', '123')).toMatchObject({
      enabled: true,
      ok: false,
      reason: 'missing_TELNYX_PUBLIC_KEY'
    });
  });

  it('accepts a valid ed25519 signature', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    process.env.TELNYX_VERIFY_SIGNATURES = 'true';
    process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.TELNYX_SIGNATURE_MAX_AGE_SECONDS = '300';

    const rawBody = JSON.stringify({ data: { id: 'evt_123' } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString('base64');

    expect(verifyTelnyxWebhookSignature(rawBody, signature, timestamp)).toMatchObject({
      enabled: true,
      ok: true,
      signatureHeaderPresent: true,
      timestampHeaderPresent: true
    });
  });

  it('rejects stale timestamps and signature mismatches', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    process.env.TELNYX_VERIFY_SIGNATURES = 'true';
    process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.TELNYX_SIGNATURE_MAX_AGE_SECONDS = '60';

    const rawBody = JSON.stringify({ data: { id: 'evt_456' } });
    const freshTimestamp = String(Math.floor(Date.now() / 1000));
    const freshSignature = sign(null, Buffer.from(`${freshTimestamp}|${rawBody}`), privateKey).toString('base64');
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);

    expect(verifyTelnyxWebhookSignature(rawBody, freshSignature, staleTimestamp)).toMatchObject({
      enabled: true,
      ok: false,
      reason: 'stale_signature_timestamp'
    });

    expect(verifyTelnyxWebhookSignature(rawBody, 'totally-wrong', freshTimestamp)).toMatchObject({
      enabled: true,
      ok: false
    });
  });
});
